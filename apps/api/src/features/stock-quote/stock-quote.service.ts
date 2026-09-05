import { Inject, Injectable } from '@nestjs/common';
import { Clock, Effect } from 'effect';
import { PinoLogger } from 'nestjs-pino';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import type { FugleConfigError, FugleQuoteError } from './fugle-quote.error.js';
import { FugleQuoteProvider } from './fugle-quote.provider.js';
import type { QuoteProviderResult } from './quote-provider.js';
import { StockQuoteCache } from './stock-quote.cache.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';

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
    @Inject(StockQuoteCache) private readonly cache: StockQuoteCache,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {}

  getQuote(symbol: string): Effect.Effect<StockQuoteResponse, FugleQuoteError | TwseMisQuoteError> {
    return Effect.gen(this, function* () {
      const lookupTime = yield* Clock.currentTimeMillis;
      const hit = this.cache.get(symbol, lookupTime);
      if (hit) {
        // Cache hits preserve the original provenance; only the flag flips.
        // No TTL extension, no fetchedAt/asOf rewrite, no mutation — and no
        // fallback event: replaying history is not a new fallback.
        const cached = { ...hit, source: { ...hit.source, cacheHit: true } };
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
      const completed = yield* this.fugleQuoteProvider.getQuote(symbol).pipe(
        Effect.map((result) => ({ ...result, provider: 'fugle', fallbackUsed: false }) as const),
        Effect.catchAll(
          (
            error,
          ): Effect.Effect<
            QuoteProviderResult & { readonly provider: 'twse-mis'; readonly fallbackUsed: true },
            FugleQuoteError | TwseMisQuoteError
          > => {
            if (!isFugleFallbackEligible(error)) {
              return Effect.fail(error);
            }
            this.logger.warn({
              event: 'market_data_fallback',
              operation: 'quote',
              symbol,
              from_provider: 'fugle',
              to_provider: 'twse-mis',
              ...fallbackReason(error),
            });
            return Effect.map(this.twseMisQuoteProvider.getQuote(symbol), (result) => ({
              ...result,
              provider: 'twse-mis',
              fallbackUsed: true,
            }));
          },
        ),
      );
      // fetchedAt marks when the winning provider completed — consistent with
      // the TTL insertion instant, never the request start.
      const fetchedAt = yield* Clock.currentTimeMillis;
      const response: StockQuoteResponse = {
        ...completed.quote,
        source: {
          provider: completed.provider,
          fallbackUsed: completed.fallbackUsed,
          fetchedAt: new Date(fetchedAt).toISOString(),
          asOf: completed.asOf,
          cacheHit: false,
        },
      };
      this.cache.set(symbol, response, fetchedAt);
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

// Feature-local eligibility: transient/provider failures (including timeout)
// fall back, config and client errors do not. No generic policy engine.
export function isFugleFallbackEligible(error: FugleQuoteError): error is Exclude<FugleQuoteError, FugleConfigError> {
  switch (error._tag) {
    case 'FugleNetworkError':
    case 'FugleTimeoutError':
    case 'FugleDecodeError':
      return true;
    case 'FugleConfigError':
      return false;
    case 'FugleHttpError':
      return error.status === 429 || (error.status >= 500 && error.status <= 599);
  }
}

type FallbackReason =
  | { reason: 'network' | 'timeout' | 'decode' }
  | { reason: 'http_429' | 'http_5xx'; upstream_status: number };

// Low-cardinality reason for the fallback event. Only callable on eligible
// failures — ineligible ones never reach the MIS branch above.
function fallbackReason(error: Exclude<FugleQuoteError, FugleConfigError>): FallbackReason {
  switch (error._tag) {
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
