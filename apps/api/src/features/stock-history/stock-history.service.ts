import { Inject, Injectable } from '@nestjs/common';
import { Clock, Effect } from 'effect';
import type { HistoryRange, Security, StockHistoryResponse } from '@tw-stock-dashboard/contracts';
import type { StockHistoryServiceError } from './fugle-history.error.js';
import { IntradayRangeUnavailableError } from './fugle-history.error.js';
import { FugleHistoryProvider } from './fugle-history.provider.js';
import { OfficialDailyHistoryProvider } from './official-daily-history.provider.js';
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
import type { StockNotFoundError, UniverseUnavailableError } from '../../libs/securities/universe.error.js';
import { UniverseResolver } from '../../libs/securities/universe.resolver.js';

function isFugleKeyPresent(): boolean {
  const key = process.env.FUGLE_API_KEY?.trim();
  return Boolean(key && key !== 'your_fugle_api_key_here');
}

export function isEligibleFugleDailyFallback(err: StockHistoryServiceError): boolean {
  if (
    err._tag === 'FugleHistoryNetworkError' ||
    err._tag === 'FugleHistoryTimeoutError' ||
    err._tag === 'FugleHistoryDecodeError'
  ) {
    return true;
  }
  if (err._tag === 'FugleHistoryHttpError') {
    return err.status === 429 || (err.status >= 500 && err.status <= 599);
  }
  return false;
}

@Injectable()
export class StockHistoryService {
  constructor(
    @Inject(FugleHistoryProvider) private readonly fugleHistoryProvider: FugleHistoryProvider,
    @Inject(OfficialDailyHistoryProvider) private readonly officialDailyHistoryProvider: OfficialDailyHistoryProvider,
    @Inject(UniverseResolver) private readonly universe: UniverseResolver,
  ) {}

  getHistory(
    symbol: string,
    range: HistoryRange,
  ): Effect.Effect<StockHistoryResponse, StockHistoryServiceError | StockNotFoundError | UniverseUnavailableError> {
    // Local validation first: no network I/O for a range that can never be
    // served. Universe resolution follows for 404/503 semantics.
    if (isIntradayRange(range) && !isFugleKeyPresent()) {
      return Effect.fail(new IntradayRangeUnavailableError());
    }
    return Effect.gen(this, function* () {
      const security = yield* this.universe.resolve(symbol);
      if (isIntradayRange(range)) {
        return yield* this.getIntradayHistory(symbol, range);
      }
      return yield* this.getDailyHistory(security, range);
    });
  }

  private getIntradayHistory(
    symbol: string,
    range: '1d' | '3d' | '5d',
  ): Effect.Effect<StockHistoryResponse, StockHistoryServiceError> {
    const hasKey = isFugleKeyPresent();
    if (!hasKey) {
      return Effect.fail(new IntradayRangeUnavailableError());
    }

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
      const merged = mergeCandles([historical.candles, intraday.candles]);
      const withMa = applyMovingAverages(merged);
      const cropped = cropToLastTradingDays(withMa, INTRADAY_TRADING_DAYS[range]).map((candle) => ({
        ...candle,
        average: null,
      }));
      return {
        symbol: historical.symbol,
        market: historical.market,
        range,
        timeframe: '5m' as const,
        volumeUnit: 'lot' as const,
        priceBasis: 'close' as const,
        candles: cropped,
        source: {
          provider: 'fugle' as const,
          mode: 'intraday' as const,
          asOf: null,
        },
      };
    });
  }

  private getDailyHistory(
    security: Security,
    range: '1m' | '3m' | '6m' | '1y',
  ): Effect.Effect<StockHistoryResponse, StockHistoryServiceError> {
    const symbol = security.symbol;
    return Effect.gen(this, function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const visible = historyWindow(range, nowMs);
      const warmupFrom = shiftCalendarMonths(visible.from, -WARMUP_MONTHS);
      const hasKey = isFugleKeyPresent();
      if (security.market === 'ESB') {
        return yield* this.getOfficialDailyHistory(security, range, warmupFrom, visible.from, visible.to);
      }

      if (hasKey) {
        const fugleAttempt = Effect.gen(this, function* () {
          const chunks = splitQueryWindows(warmupFrom, visible.to);
          const results = yield* Effect.all(
            chunks.map((chunk) => this.fugleHistoryProvider.getDaily(symbol, chunk.from, chunk.to)),
            { concurrency: chunks.length },
          );
          const merged: BaseCandle[] = mergeCandles(results.map((result) => result.candles));
          const withMa = applyMovingAverages(merged);
          const visibleCandles = withMa
            .filter((candle) => candle.date >= visible.from)
            .map((candle) => ({ ...candle, average: null }));
          const first = results[0];
          return {
            symbol: first.symbol,
            market: first.market,
            range,
            timeframe: '1d' as const,
            volumeUnit: 'share' as const,
            priceBasis: 'close' as const,
            candles: visibleCandles,
            source: {
              provider: 'fugle' as const,
              mode: 'eod' as const,
              asOf: visibleCandles.length ? visibleCandles[visibleCandles.length - 1].date : null,
            },
          };
        });

        return yield* fugleAttempt.pipe(
          Effect.catchAll((err) => {
            if (!isEligibleFugleDailyFallback(err)) {
              return Effect.fail(err);
            }
            return this.getOfficialDailyHistory(security, range, warmupFrom, visible.from, visible.to);
          }),
        );
      }

      return yield* this.getOfficialDailyHistory(security, range, warmupFrom, visible.from, visible.to);
    });
  }

  private getOfficialDailyHistory(
    security: Security,
    range: '1m' | '3m' | '6m' | '1y',
    warmupFrom: string,
    visibleFrom: string,
    visibleTo: string,
  ): Effect.Effect<StockHistoryResponse, StockHistoryServiceError> {
    return Effect.gen(this, function* () {
      const official = yield* this.officialDailyHistoryProvider.getDailyHistory(
        security,
        warmupFrom,
        visibleTo,
      );
      const withMa = applyMovingAverages(official.candles);
      const visibleCandles = withMa
        .filter((c) => c.date >= visibleFrom)
        .map((candle) => ({ ...candle, average: null }));
      return {
        symbol: official.symbol,
        market: official.market,
        range,
        timeframe: '1d' as const,
        volumeUnit: 'share' as const,
        priceBasis: 'close' as const,
        candles: visibleCandles,
        source: {
          provider: official.provider,
          mode: 'eod' as const,
          asOf: visibleCandles.length ? visibleCandles[visibleCandles.length - 1].date : null,
        },
      };
    });
  }
}
