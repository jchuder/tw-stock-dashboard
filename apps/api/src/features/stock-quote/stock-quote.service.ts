import { Inject, Injectable } from '@nestjs/common';
import { Clock, Effect } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import type { FugleQuoteError } from './fugle-quote.error.js';
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
// NOTE: @Inject is explicit because vitest (esbuild) does not emit
// decorator metadata, so Nest cannot infer constructor types in tests.
@Injectable()
export class StockQuoteService {
  constructor(
    @Inject(FugleQuoteProvider) private readonly fugleQuoteProvider: FugleQuoteProvider,
    @Inject(TwseMisQuoteProvider) private readonly twseMisQuoteProvider: TwseMisQuoteProvider,
    @Inject(StockQuoteCache) private readonly cache: StockQuoteCache,
  ) {}

  getQuote(symbol: string): Effect.Effect<StockQuoteResponse, FugleQuoteError | TwseMisQuoteError> {
    return Effect.gen(this, function* () {
      const lookupTime = yield* Clock.currentTimeMillis;
      const hit = this.cache.get(symbol, lookupTime);
      if (hit) {
        // Cache hits preserve the original provenance; only the flag flips.
        // No TTL extension, no fetchedAt/asOf rewrite, no mutation.
        return { ...hit, source: { ...hit.source, cacheHit: true } };
      }
      const completed = yield* this.fugleQuoteProvider.getQuote(symbol).pipe(
        Effect.map((result) => ({ ...result, provider: 'fugle', fallbackUsed: false }) as const),
        Effect.catchAll(
          (
            error,
          ): Effect.Effect<
            QuoteProviderResult & { readonly provider: 'twse-mis'; readonly fallbackUsed: true },
            FugleQuoteError | TwseMisQuoteError
          > =>
            isFugleFallbackEligible(error)
              ? Effect.map(this.twseMisQuoteProvider.getQuote(symbol), (result) => ({
                  ...result,
                  provider: 'twse-mis',
                  fallbackUsed: true,
                }))
              : Effect.fail(error),
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
      return response;
    });
  }
}

// Feature-local eligibility: transient/provider failures (including timeout)
// fall back, config and client errors do not. No generic policy engine.
export function isFugleFallbackEligible(error: FugleQuoteError): boolean {
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
