import { Inject, Injectable } from '@nestjs/common';
import { Clock, Effect } from 'effect';
import type { HistoryRange, StockHistoryResponse } from '@tw-stock-dashboard/contracts';
import type { FugleHistoryError } from './fugle-history.error.js';
import { FugleHistoryProvider } from './fugle-history.provider.js';
import { historyWindow, shiftCalendarMonths, WARMUP_MONTHS } from './history-window.js';
import { applyMovingAverages } from './moving-average.js';

// Service orchestrates the warm-up window, delegates to the Fugle provider,
// computes moving averages, crops to the requested visible range, and assembles
// the public StockHistoryResponse.
// NOTE: @Inject is explicit because vitest (esbuild) does not emit
// decorator metadata, so Nest cannot infer constructor types in tests.
@Injectable()
export class StockHistoryService {
  constructor(@Inject(FugleHistoryProvider) private readonly fugleHistoryProvider: FugleHistoryProvider) {}

  getHistory(symbol: string, range: HistoryRange): Effect.Effect<StockHistoryResponse, FugleHistoryError> {
    return Effect.gen(this, function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const visible = historyWindow(range, nowMs);
      const warmupFrom = shiftCalendarMonths(visible.from, -WARMUP_MONTHS);
      const result = yield* this.fugleHistoryProvider.getHistory(symbol, warmupFrom, visible.to);
      const withMa = applyMovingAverages(result.candles);
      const visibleCandles = withMa.filter((candle) => candle.date >= visible.from);

      return {
        symbol: result.symbol,
        market: result.market,
        range,
        candles: visibleCandles,
      };
    });
  }
}
