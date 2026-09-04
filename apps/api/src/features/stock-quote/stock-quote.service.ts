import { Inject, Injectable } from '@nestjs/common';
import { Clock, Effect } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import type { FugleQuoteError } from './fugle-quote.error.js';
import { FugleQuoteProvider } from './fugle-quote.provider.js';
import { StockQuoteCache } from './stock-quote.cache.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';

// Application seam: TTL cache in front of the Fugle primary / TWSE MIS
// fallback workflow. Only normalized successes are cached — failures skip the
// write and the next request retries upstream. Lookup runs before any
// provider, so a cached quote survives even a later-removed API key until TTL.
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
      const now = yield* Clock.currentTimeMillis;
      const hit = this.cache.get(symbol, now);
      if (hit) {
        return hit;
      }
      const quote = yield* this.fugleQuoteProvider.getQuote(symbol).pipe(
        Effect.catchAll(
          (error): Effect.Effect<StockQuoteResponse, FugleQuoteError | TwseMisQuoteError> =>
            isFugleFallbackEligible(error) ? this.twseMisQuoteProvider.getQuote(symbol) : Effect.fail(error),
        ),
      );
      this.cache.set(symbol, quote, now);
      return quote;
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
