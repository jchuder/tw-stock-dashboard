import { Inject, Injectable } from '@nestjs/common';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { FugleQuoteProvider } from './fugle-quote.provider.js';

// Application seam for the stock-quote slice. Single implementation on
// purpose: no provider port/interface until Q3 adds a second source.
// NOTE: @Inject is explicit because vitest (esbuild) does not emit
// decorator metadata, so Nest cannot infer constructor types in tests.
@Injectable()
export class StockQuoteService {
  constructor(@Inject(FugleQuoteProvider) private readonly fugleQuoteProvider: FugleQuoteProvider) {}

  getQuote(symbol: string): Promise<StockQuoteResponse> {
    return this.fugleQuoteProvider.getQuote(symbol);
  }
}
