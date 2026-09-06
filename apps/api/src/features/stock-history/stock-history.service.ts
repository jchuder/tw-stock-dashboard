import { Inject, Injectable } from '@nestjs/common';
import { Clock, Effect } from 'effect';
import type { HistoryRange, StockHistoryResponse } from '@tw-stock-dashboard/contracts';
import type { FugleHistoryError } from './fugle-history.error.js';
import { FugleHistoryProvider } from './fugle-history.provider.js';
import {
  cropToLastTradingDays,
  historyWindow,
  INTRADAY_TRADING_DAYS,
  isIntradayRange,
  mergeCandles,
  shiftCalendarMonths,
  splitQueryWindows,
  WARMUP_MONTHS,
} from './history-window.js';
import { applyMovingAverages } from './moving-average.js';
import type { BaseCandle } from './moving-average.js';

// Service orchestrates provider windows, computes moving averages on the
// warm-up + visible set, crops to the requested visible range, and assembles
// the public StockHistoryResponse.
// - 1D/3D/5D: 5m timeframe — historical 5m (completed sessions) merged with
//   current-session intraday 5m, MA over the merged set, then keep the last N
//   trading dates present in the data (weekend-proof).
// - 1M/3M/6M: daily timeframe with a 4-month MA warm-up prefix.
// - 1Y: full 12 calendar months visible plus the same warm-up; the provider
//   span is split into <1-year chunks that are merged before MA + crop, so
//   the visible window is never shortened to dodge the provider limit.
// NOTE: @Inject is explicit because vitest (esbuild) does not emit
// decorator metadata, so Nest cannot infer constructor types in tests.
@Injectable()
export class StockHistoryService {
  constructor(@Inject(FugleHistoryProvider) private readonly fugleHistoryProvider: FugleHistoryProvider) {}

  getHistory(symbol: string, range: HistoryRange): Effect.Effect<StockHistoryResponse, FugleHistoryError> {
    if (isIntradayRange(range)) {
      return this.getIntradayHistory(symbol, range);
    }
    return this.getDailyHistory(symbol, range);
  }

  private getIntradayHistory(symbol: string, range: '1d' | '3d' | '5d'): Effect.Effect<StockHistoryResponse, FugleHistoryError> {
    return Effect.gen(this, function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const window = historyWindow(range, nowMs);
      const [historical, intraday] = yield* Effect.all(
        [
          this.fugleHistoryProvider.getHistorical5m(symbol, window.from, window.to),
          this.fugleHistoryProvider.getIntraday5m(symbol),
        ],
        { concurrency: 2 },
      );
      // MA warm-up first on the merged chronological set, then crop to the
      // last N trading dates — early visible bars still get correct MAs from
      // the lookback prefix instead of nulls.
      const merged = mergeCandles([historical.candles, intraday.candles]);
      const withMa = applyMovingAverages(merged);
      return {
        symbol: historical.symbol,
        market: historical.market,
        range,
        timeframe: '5m' as const,
        volumeUnit: 'lot' as const,
        candles: cropToLastTradingDays(withMa, INTRADAY_TRADING_DAYS[range]),
      };
    });
  }

  private getDailyHistory(
    symbol: string,
    range: '1m' | '3m' | '6m' | '1y',
  ): Effect.Effect<StockHistoryResponse, FugleHistoryError> {
    return Effect.gen(this, function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const visible = historyWindow(range, nowMs);
      const warmupFrom = shiftCalendarMonths(visible.from, -WARMUP_MONTHS);
      const chunks = splitQueryWindows(warmupFrom, visible.to);
      const results = yield* Effect.all(
        chunks.map((chunk) => this.fugleHistoryProvider.getDaily(symbol, chunk.from, chunk.to)),
        { concurrency: chunks.length },
      );
      const merged: BaseCandle[] = mergeCandles(results.map((result) => result.candles));
      const withMa = applyMovingAverages(merged);
      const visibleCandles = withMa.filter((candle) => candle.date >= visible.from);

      const first = results[0];
      return {
        symbol: first.symbol,
        market: first.market,
        range,
        timeframe: '1d' as const,
        volumeUnit: 'share' as const,
        candles: visibleCandles,
      };
    });
  }
}
