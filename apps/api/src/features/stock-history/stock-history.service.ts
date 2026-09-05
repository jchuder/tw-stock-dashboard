import { Inject, Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import type { HistoryRange, StockHistoryResponse } from '@tw-stock-dashboard/contracts';
import type { FugleHistoryError } from './fugle-history.error.js';
import { FugleHistoryProvider } from './fugle-history.provider.js';

// Application seam for the history slice. Pure delegation: no cache, no
// fallback, no metadata in Q7 — those dimensions arrive in later slices.
// NOTE: @Inject is explicit because vitest (esbuild) does not emit
// decorator metadata, so Nest cannot infer constructor types in tests.
@Injectable()
export class StockHistoryService {
  constructor(@Inject(FugleHistoryProvider) private readonly fugleHistoryProvider: FugleHistoryProvider) {}

  getHistory(symbol: string, range: HistoryRange): Effect.Effect<StockHistoryResponse, FugleHistoryError> {
    return this.fugleHistoryProvider.getHistory(symbol, range);
  }
}
