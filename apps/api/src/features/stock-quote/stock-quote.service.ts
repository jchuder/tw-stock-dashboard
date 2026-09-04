import { Inject, Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import type { FugleQuoteError } from './fugle-quote.error.js';
import { FugleQuoteProvider } from './fugle-quote.provider.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';

// Application seam: Fugle primary, TWSE MIS fallback on transient provider
// failures only. Config/auth failures stay loud — never silently fall back.
// NOTE: @Inject is explicit because vitest (esbuild) does not emit
// decorator metadata, so Nest cannot infer constructor types in tests.
@Injectable()
export class StockQuoteService {
  constructor(
    @Inject(FugleQuoteProvider) private readonly fugleQuoteProvider: FugleQuoteProvider,
    @Inject(TwseMisQuoteProvider) private readonly twseMisQuoteProvider: TwseMisQuoteProvider,
  ) {}

  getQuote(symbol: string): Effect.Effect<StockQuoteResponse, FugleQuoteError | TwseMisQuoteError> {
    return this.fugleQuoteProvider.getQuote(symbol).pipe(
      Effect.catchAll(
        (error): Effect.Effect<StockQuoteResponse, FugleQuoteError | TwseMisQuoteError> =>
          isFugleFallbackEligible(error) ? this.twseMisQuoteProvider.getQuote(symbol) : Effect.fail(error),
      ),
    );
  }
}

// Feature-local eligibility: transient/provider failures fall back, config
// and client errors do not. No generic policy engine.
export function isFugleFallbackEligible(error: FugleQuoteError): boolean {
  switch (error._tag) {
    case 'FugleNetworkError':
    case 'FugleDecodeError':
      return true;
    case 'FugleConfigError':
      return false;
    case 'FugleHttpError':
      return error.status === 429 || (error.status >= 500 && error.status <= 599);
  }
}
