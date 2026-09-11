import { Inject, Injectable } from '@nestjs/common';
import { Clock, Effect, Either } from 'effect';
import { PinoLogger } from 'nestjs-pino';
import type {
  Security,
  StockQuoteBatchItem,
  StockQuoteBatchResponse,
  StockQuoteProvider,
  StockQuoteResponse,
} from '@tw-stock-dashboard/contracts';
import type { FugleQuoteError } from './fugle-quote.error.js';
import { FugleQuoteProvider, isFugleConfigured } from './fugle-quote.provider.js';
import { OfficialDailyQuoteProvider } from './official-daily-quote.provider.js';
import type { OfficialDailyQuoteError } from './official-daily-quote.error.js';
import { StockQuoteCache, type StockQuoteMode } from './stock-quote.cache.js';
import type { QuoteProviderResult } from './quote-provider.js';
import { addSpanEvent, setSpanAttributes } from '../../libs/observability/tracing.js';
import { StockNotFoundError, UniverseUnavailableError } from '../../libs/securities/universe.error.js';
import { UniverseResolver } from '../../libs/securities/universe.resolver.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';
import type { TpexEsbQuoteError } from './tpex-esb-quote.error.js';
import { TpexEsbQuoteProvider } from './tpex-esb-quote.provider.js';
import type { CacheInfrastructureError } from '../../libs/cache/cache.service.js';
import type { WindowCoordinationTimeoutError } from '../../libs/cache/window-cache.error.js';

export type StockQuoteFailure =
  | FugleQuoteError
  | TwseMisQuoteError
  | OfficialDailyQuoteError
  | TpexEsbQuoteError
  | StockNotFoundError
  | UniverseUnavailableError
  | CacheInfrastructureError
  | WindowCoordinationTimeoutError;

// Application seam: Redis window-cache in front of Fugle, TWSE MIS, and official
// daily fallback workflows, with source metadata assembled in one place.
// Freshness is windowId. Fugle mode is selected before lookup so enhanced and
// public namespaces never reuse each other.
// Request correlation comes free: PinoLogger binds the request-scoped child
// logger (request_id) wherever a request context exists.
// NOTE: @Inject is explicit because vitest (esbuild) does not emit
// decorator metadata, so Nest cannot infer constructor types in tests.
@Injectable()
export class StockQuoteService {
  constructor(
    @Inject(FugleQuoteProvider) private readonly fugleQuoteProvider: FugleQuoteProvider,
    @Inject(TwseMisQuoteProvider) private readonly twseMisQuoteProvider: TwseMisQuoteProvider,
    @Inject(OfficialDailyQuoteProvider) private readonly officialDailyQuoteProvider: OfficialDailyQuoteProvider,
    @Inject(TpexEsbQuoteProvider) private readonly tpexEsbQuoteProvider: TpexEsbQuoteProvider,
    @Inject(StockQuoteCache) private readonly cache: StockQuoteCache,
    @Inject(UniverseResolver) private readonly universe: UniverseResolver,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {}
  getQuote(symbol: string): Effect.Effect<StockQuoteResponse, StockQuoteFailure> {
    return Effect.gen(this, function* () {
      // Universe first: unknown symbols fail 404/503 here, and the resolved
      // market selects the provider — ESB never touches Fugle or MIS.
      const security = yield* this.universe.resolve(symbol);
      const mode: StockQuoteMode = isFugleConfigured() ? 'enhanced' : 'public';
      const response = yield* this.cache.getOrLoad({
        symbol,
        mode,
        load: () => this.orchestrateQuote(security),
      });

      setSpanAttributes(servedSpanAttributes(response.source.provider, response.source.fallbackUsed, response.source.cacheHit));
      addSpanEvent(
        'market_data.quote_served',
        servedSpanAttributes(response.source.provider, response.source.fallbackUsed, response.source.cacheHit),
      );
      this.logger.info({
        event: 'market_data_quote_served',
        operation: 'quote',
        symbol,
        provider: response.source.provider,
        fallback_used: response.source.fallbackUsed,
        cache_hit: response.source.cacheHit,
      });

      return response;
    });
  }

  private orchestrateQuote(
    security: Security,
  ): Effect.Effect<
    StockQuoteResponse,
    FugleQuoteError | TwseMisQuoteError | OfficialDailyQuoteError | TpexEsbQuoteError | StockNotFoundError
  > {
    return Effect.gen(this, function* () {
      const symbol = security.symbol;
      if (security.market === 'ESB') {
        const esb = yield* this.tpexEsbQuoteProvider.getQuote(symbol);
        const completed = {
          ...esb,
          provider: 'tpex-esb',
          fallbackUsed: false,
          fallbackReason: null,
        } as const;
        return yield* this.assemble(completed);
      }
      const completed = yield* this.fugleQuoteProvider.getQuote(symbol).pipe(
        Effect.map(
          (result) =>
            ({
              ...result,
              provider: 'fugle',
              fallbackUsed: false,
              fallbackReason: null,
            }) as const,
        ),
        Effect.catchAll(
          (
            error,
          ): Effect.Effect<
            QuoteProviderResult & {
              readonly provider: StockQuoteProvider;
              readonly fallbackUsed: true;
              readonly fallbackReason: 'config_missing' | 'upstream_unavailable';
            },
            FugleQuoteError | TwseMisQuoteError | OfficialDailyQuoteError | StockNotFoundError
          > => {
            if (error._tag === 'FugleHttpError' && error.status === 404) {
              return Effect.fail(new StockNotFoundError());
            }
            if (!isFugleFallbackEligible(error)) {
              return Effect.fail(error);
            }

            if (error._tag === 'FugleConfigError') {
              const officialMarket =
                security.market === 'TWSE' || security.market === 'TPEX' ? security.market : null;
              if (officialMarket === null) {
                return Effect.fail(error);
              }
              const fallback = fallbackReason(error);
              return this.resolvePublicDataQuote(symbol, officialMarket, fallback);
            }

            const fallback = fallbackReason(error);
            const logPayload = {
              event: 'market_data_fallback',
              operation: 'quote',
              symbol,
              from_provider: 'fugle',
              to_provider: 'twse-mis' as const,
              fallback_reason: 'upstream_unavailable' as const,
              ...fallback,
            };
            this.logger.warn(logPayload);
            addSpanEvent('market_data.fallback', {
              'stock.symbol': symbol,
              'market_data.from_provider': 'fugle',
              'market_data.to_provider': 'twse-mis',
              'market_data.reason': fallback.reason,
              'market_data.reason_type': 'upstream_unavailable',
              ...('upstream_status' in fallback ? { 'market_data.upstream_status': fallback.upstream_status } : {}),
            });
            return Effect.map(this.twseMisQuoteProvider.getQuote(symbol), (result) => ({
              ...result,
              provider: 'twse-mis' as const,
              fallbackUsed: true,
              fallbackReason: 'upstream_unavailable' as const,
            }));
          },
        ),
      );
      return yield* this.assemble(completed);
    });
  }

  getQuotes(
    symbols: readonly string[],
  ): Effect.Effect<StockQuoteBatchResponse, CacheInfrastructureError | UniverseUnavailableError> {
    return Effect.gen(this, function* () {
      // One bounded batch request avoids a browser-side N+1 API pattern while
      // preserving independent per-symbol failure states.
      const outcomes = yield* Effect.all(
        symbols.map((symbol) => Effect.either(this.getQuote(symbol))),
        { concurrency: 4 },
      );
      // Global Redis outage: if Redis connection is dead or throwing command errors,
      // fail the entire batch closed with 503.
      const redisOutage = outcomes.find(
        (outcome): outcome is Either.Left<CacheInfrastructureError, StockQuoteResponse> =>
          Either.isLeft(outcome) &&
          (outcome.left._tag === 'RedisConnectionError' || outcome.left._tag === 'RedisCommandError'),
      );
      if (redisOutage) {
        return yield* Effect.fail(redisOutage.left);
      }
      // If the universe is completely unavailable for all symbols, fail the batch with 503.
      if (
        outcomes.length > 0 &&
        outcomes.every((outcome) => Either.isLeft(outcome) && outcome.left._tag === 'UniverseUnavailableError')
      ) {
        return yield* Effect.fail(new UniverseUnavailableError());
      }
      // Per-symbol problems (single-symbol lock timeout, provider failure, not found, etc.)
      // resolve as individual item statuses within an HTTP 200 batch response.
      const items: StockQuoteBatchItem[] = symbols.map((symbol, index) => {
        const outcome = outcomes[index]!;
        if (Either.isRight(outcome)) {
          return { symbol, quote: outcome.right, error: null };
        }
        return { symbol, quote: null, error: batchError(outcome.left) };
      });
      return { items };
    });
  }

  // Public Data Mode (no Fugle key): official daily EOD plus TWSE MIS as a
  // completed-session freshness candidate. A MIS snapshot counts as a closed
  // candidate only with proof of a completed close: session time >= 13:30 on
  // a prior date, or the same proof observed after today's 13:35 settlement
  // grace. Missing/invalid session time can never override official — date
  // alone is not proof of a completed session. Between two closed snapshots
  // the newer tradeDate wins either direction. MIS is auxiliary: its failure
  // never breaks Public Data availability. fallbackReason stays
  // config_missing because the frontend keys Public Data Mode off it.
  private resolvePublicDataQuote(
    symbol: string,
    market: 'TWSE' | 'TPEX',
    fallback: FallbackReason,
  ): Effect.Effect<
    QuoteProviderResult & {
      readonly provider: 'twse-openapi' | 'tpex-openapi' | 'twse-mis';
      readonly fallbackUsed: true;
      readonly fallbackReason: 'config_missing';
    },
    OfficialDailyQuoteError
  > {
    return Effect.gen(this, function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(new Date(nowMs));
      const byType: Record<string, string> = {};
      for (const part of parts) {
        byType[part.type] = part.value;
      }
      const today = `${byType.year}-${byType.month}-${byType.day}`;
      const nowTime = `${byType.hour}:${byType.minute}:${byType.second}`;
      const official = yield* this.officialDailyQuoteProvider.getQuote(symbol, market);
      const mis = yield* this.twseMisQuoteProvider.getQuote(symbol).pipe(
        Effect.asSome,
        Effect.catchAll(() => Effect.succeedNone),
      );
      const misResult = mis._tag === 'Some' ? mis.value : null;
      const misDate = misResult?.quote.tradeDate ?? null;
      const misTime = misResult?.sessionTime ?? null;
      let winner: {
        result: QuoteProviderResult;
        provider: 'twse-openapi' | 'tpex-openapi' | 'twse-mis';
      };
      if (
        misResult !== null &&
        misDate !== null &&
        misTime !== null &&
        misTime >= '13:30:00' &&
        (misDate < today || (misDate === today && nowTime >= '13:35:00')) &&
        (official.quote.tradeDate === null || misDate > official.quote.tradeDate)
      ) {
        winner = { result: misResult, provider: 'twse-mis' };
      } else {
        winner = {
          result: official,
          provider: market === 'TWSE' ? 'twse-openapi' : 'tpex-openapi',
        };
      }
      const logPayload = {
        event: 'market_data_fallback',
        operation: 'quote',
        symbol,
        from_provider: 'fugle',
        to_provider: winner.provider,
        fallback_reason: 'config_missing' as const,
        ...fallback,
      };
      this.logger.info(logPayload);
      addSpanEvent('market_data.fallback', {
        'stock.symbol': symbol,
        'market_data.from_provider': 'fugle',
        'market_data.to_provider': winner.provider,
        'market_data.reason': fallback.reason,
        'market_data.reason_type': 'config_missing',
      });
      return {
        ...winner.result,
        provider: winner.provider,
        fallbackUsed: true as const,
        fallbackReason: 'config_missing' as const,
      };
    });
  }

  // Shared response assembly: provenance stamping with initial cacheHit=false.
  // WindowCacheService owns cache coordination; served log/span events are
  // emitted at the service boundary so hits and misses are coherent.
  private assemble(
    completed: QuoteProviderResult & {
      readonly provider: StockQuoteProvider;
      readonly fallbackUsed: boolean;
      readonly fallbackReason: 'config_missing' | 'upstream_unavailable' | null;
    },
  ): Effect.Effect<StockQuoteResponse, never> {
    return Effect.gen(this, function* () {
      const fetchedAt = yield* Clock.currentTimeMillis;
      const response: StockQuoteResponse = {
        ...completed.quote,
        source: {
          provider: completed.provider,
          fallbackUsed: completed.fallbackUsed,
          fallbackReason: completed.fallbackReason,
          fetchedAt: new Date(fetchedAt).toISOString(),
          asOf: completed.asOf,
          cacheHit: false,
        },
      };
      return response;
    });
  }
}

function batchError(error: StockQuoteFailure): NonNullable<StockQuoteBatchItem['error']> {
  if (error._tag === 'StockNotFoundError') {
    return 'not_found';
  }
  if (
    error._tag === 'UniverseUnavailableError' ||
    error._tag === 'RedisCommandError' ||
    error._tag === 'RedisConnectionError' ||
    error._tag === 'WindowCoordinationTimeoutError' ||
    error._tag === 'TpexEsbCacheError' ||
    (error._tag === 'OfficialDailyQuoteError' && error.stage === 'cache')
  ) {
    return 'unavailable';
  }
  return 'failed';
}

// Feature-local eligibility: transient/provider failures (including timeout)
// and missing configuration use an official market-data fallback. Invalid key
// (401/403) or client errors (404) do not fall back.
export function isFugleFallbackEligible(error: FugleQuoteError): boolean {
  switch (error._tag) {
    case 'FugleConfigError':
    case 'FugleNetworkError':
    case 'FugleTimeoutError':
    case 'FugleDecodeError':
      return true;
    case 'FugleHttpError':
      return error.status === 429 || (error.status >= 500 && error.status <= 599);
  }
}

type FallbackReason =
  | { reason: 'config_missing' }
  | { reason: 'network' | 'timeout' | 'decode' }
  | { reason: 'http_429' | 'http_5xx'; upstream_status: number };

function fallbackReason(error: FugleQuoteError): FallbackReason {
  switch (error._tag) {
    case 'FugleConfigError':
      return { reason: 'config_missing' };
    case 'FugleNetworkError':
      return { reason: 'network' };
    case 'FugleTimeoutError':
      return { reason: 'timeout' };
    case 'FugleDecodeError':
      return { reason: 'decode' };
    case 'FugleHttpError':
      return error.status === 429
        ? { reason: 'http_429', upstream_status: error.status }
        : { reason: 'http_5xx', upstream_status: error.status };
  }
}

function servedSpanAttributes(provider: StockQuoteProvider, fallbackUsed: boolean, cacheHit: boolean) {
  return {
    'market_data.provider': provider,
    'market_data.fallback_used': fallbackUsed,
    'market_data.cache_hit': cacheHit,
  };
}
