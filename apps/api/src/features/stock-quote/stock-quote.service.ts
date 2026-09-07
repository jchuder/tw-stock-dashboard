import { Inject, Injectable } from '@nestjs/common';
import { Clock, Effect, Either } from 'effect';
import { PinoLogger } from 'nestjs-pino';
import type { StockQuoteBatchItem, StockQuoteBatchResponse, StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import type { FugleQuoteError } from './fugle-quote.error.js';
import { FugleQuoteProvider } from './fugle-quote.provider.js';
import { StockQuoteCache } from './stock-quote.cache.js';
import type { QuoteProviderResult } from './quote-provider.js';
import { addSpanEvent, setSpanAttributes } from '../../libs/observability/tracing.js';
import type { UniverseUnavailableError } from '../../libs/securities/universe.error.js';
import { StockNotFoundError } from '../../libs/securities/universe.error.js';
import { UniverseResolver } from '../../libs/securities/universe.resolver.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';
import type { TpexEsbQuoteError } from './tpex-esb-quote.error.js';
import { TpexEsbQuoteProvider } from './tpex-esb-quote.provider.js';

type StockQuoteFailure =
  | FugleQuoteError
  | TwseMisQuoteError
  | TpexEsbQuoteError
  | StockNotFoundError
  | UniverseUnavailableError;

// Application seam: TTL cache in front of the Fugle primary / TWSE MIS
// fallback workflow, and the single place that assembles source metadata.
// Only normalized successes are cached — failures skip the write and the next
// request retries upstream. Lookup runs before any provider, so a cached quote
// is served even if the key was removed afterwards, until TTL.
// Request correlation comes free: PinoLogger binds the request-scoped child
// logger (request_id) wherever a request context exists.
// NOTE: @Inject is explicit because vitest (esbuild) does not emit
// decorator metadata, so Nest cannot infer constructor types in tests.
@Injectable()
export class StockQuoteService {
  constructor(
    @Inject(FugleQuoteProvider) private readonly fugleQuoteProvider: FugleQuoteProvider,
    @Inject(TwseMisQuoteProvider) private readonly twseMisQuoteProvider: TwseMisQuoteProvider,
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
      const lookupTime = yield* Clock.currentTimeMillis;
      const hit = this.cache.get(symbol, lookupTime);
      if (hit) {
        // Cache hits preserve the original provenance; only the flag flips.
        // No TTL extension, no fetchedAt/asOf rewrite, no mutation — and no
        // fallback event: replaying history is not a new fallback.
        const cached = { ...hit, source: { ...hit.source, cacheHit: true } };
        setSpanAttributes(servedSpanAttributes(cached.source.provider, cached.source.fallbackUsed, true));
        addSpanEvent('market_data.quote_served', servedSpanAttributes(cached.source.provider, cached.source.fallbackUsed, true));
        this.logger.info({
          event: 'market_data_quote_served',
          operation: 'quote',
          symbol,
          provider: cached.source.provider,
          fallback_used: cached.source.fallbackUsed,
          cache_hit: true,
        });
        return cached;
      }
      if (security.market === 'ESB') {
        const esb = yield* this.tpexEsbQuoteProvider.getQuote(symbol);
        const completed = {
          ...esb,
          provider: 'tpex-esb',
          fallbackUsed: false,
          fallbackReason: null,
        } as const;
        return yield* this.assemble(symbol, completed);
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
              readonly provider: 'twse-mis';
              readonly fallbackUsed: true;
              readonly fallbackReason: 'config_missing' | 'upstream_unavailable';
            },
            FugleQuoteError | TwseMisQuoteError | StockNotFoundError
          > => {
            if (error._tag === 'FugleHttpError' && error.status === 404) {
              return Effect.fail(new StockNotFoundError());
            }
            if (!isFugleFallbackEligible(error)) {
              return Effect.fail(error);
            }
            const reasonType =
              error._tag === 'FugleConfigError'
                ? ('config_missing' as const)
                : ('upstream_unavailable' as const);
            const fallback = fallbackReason(error);
            const logPayload = {
              event: 'market_data_fallback',
              operation: 'quote',
              symbol,
              from_provider: 'fugle',
              to_provider: 'twse-mis',
              fallback_reason: reasonType,
              ...fallback,
            };
            if (reasonType === 'config_missing') {
              this.logger.info(logPayload);
            } else {
              this.logger.warn(logPayload);
            }
            addSpanEvent('market_data.fallback', {
              'stock.symbol': symbol,
              'market_data.from_provider': 'fugle',
              'market_data.to_provider': 'twse-mis',
              'market_data.reason': fallback.reason,
              'market_data.reason_type': reasonType,
              ...('upstream_status' in fallback ? { 'market_data.upstream_status': fallback.upstream_status } : {}),
            });
            return Effect.map(this.twseMisQuoteProvider.getQuote(symbol), (result) => ({
              ...result,
              provider: 'twse-mis',
              fallbackUsed: true,
              fallbackReason: reasonType,
            }));
          },
        ),
      );
      return yield* this.assemble(symbol, completed);
    });
  }

  getQuotes(symbols: readonly string[]): Effect.Effect<StockQuoteBatchResponse, never> {
    return Effect.gen(this, function* () {
      // One bounded batch request avoids a browser-side N+1 API pattern while
      // preserving independent per-symbol failure states.
      const outcomes = yield* Effect.all(
        symbols.map((symbol) => Effect.either(this.getQuote(symbol))),
        { concurrency: 4 },
      );
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

  // Shared response assembly: provenance stamping, TTL insertion, and the
  // served log/span event. Providers stay focused on normalized quotes.
  private assemble(
    symbol: string,
    completed: QuoteProviderResult & {
      readonly provider: 'fugle' | 'twse-mis' | 'tpex-esb';
      readonly fallbackUsed: boolean;
      readonly fallbackReason: 'config_missing' | 'upstream_unavailable' | null;
    },
  ): Effect.Effect<StockQuoteResponse, never> {
    return Effect.gen(this, function* () {
      // fetchedAt marks when the winning provider completed — consistent with
      // the TTL insertion instant, never the request start.
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
      this.cache.set(symbol, response, fetchedAt);
      setSpanAttributes(servedSpanAttributes(response.source.provider, response.source.fallbackUsed, false));
      addSpanEvent('market_data.quote_served', servedSpanAttributes(response.source.provider, response.source.fallbackUsed, false));
      this.logger.info({
        event: 'market_data_quote_served',
        operation: 'quote',
        symbol,
        provider: response.source.provider,
        fallback_used: response.source.fallbackUsed,
        cache_hit: false,
      });
      return response;
    });
  }
}

function batchError(error: StockQuoteFailure): NonNullable<StockQuoteBatchItem['error']> {
  if (error._tag === 'StockNotFoundError') {
    return 'not_found';
  }
  if (error._tag === 'UniverseUnavailableError') {
    return 'unavailable';
  }
  return 'failed';
}

// Feature-local eligibility: transient/provider failures (including timeout)
// and missing configuration fall back to TWSE MIS. Invalid key (401/403) or
// client errors (404) do not fall back.
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

function servedSpanAttributes(provider: 'fugle' | 'twse-mis' | 'tpex-esb', fallbackUsed: boolean, cacheHit: boolean) {
  return {
    'market_data.provider': provider,
    'market_data.fallback_used': fallbackUsed,
    'market_data.cache_hit': cacheHit,
  };
}
