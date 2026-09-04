import { Inject, Injectable } from '@nestjs/common';
import type { Effect } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import type { FugleQuoteError } from './fugle-quote.error.js';
import { FugleQuoteProvider } from './fugle-quote.provider.js';

// Application seam for the stock-quote slice. Still pure delegation: no
// Context/Layer/ManagedRuntime and no provider port — Nest DI keeps owning
// the instance, Effect only carries the typed workflow.
// NOTE: @Inject is explicit because vitest (esbuild) does not emit
// decorator metadata, so Nest cannot infer constructor types in tests.
@Injectable()
export class StockQuoteService {
  constructor(@Inject(FugleQuoteProvider) private readonly fugleQuoteProvider: FugleQuoteProvider) {}

  getQuote(symbol: string): Effect.Effect<StockQuoteResponse, FugleQuoteError> {
    return this.fugleQuoteProvider.getQuote(symbol);
  }
}
