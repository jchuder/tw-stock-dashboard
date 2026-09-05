import { Injectable } from '@nestjs/common';
import { Clock, Duration, Effect, Schema } from 'effect';
import type { HistoryRange, StockHistoryResponse } from '@tw-stock-dashboard/contracts';
import { StockHistoryResponseSchema } from '@tw-stock-dashboard/contracts';
import type { FugleHistoryError } from './fugle-history.error.js';
import {
  FugleHistoryConfigError,
  FugleHistoryDecodeError,
  FugleHistoryHttpError,
  FugleHistoryNetworkError,
  FugleHistoryTimeoutError,
} from './fugle-history.error.js';
import { FugleHistorySchema } from './fugle-history.schema.js';
import { historyWindow } from './history-window.js';

const FUGLE_CANDLES_URL = 'https://api.fugle.tw/marketdata/v1.0/stock/historical/candles';

// Mirrors the stock-quote upstream budget (3s network fetch). Extract to a
const UPSTREAM_TIMEOUT_MS = 3000;

@Injectable()
export class FugleHistoryProvider {
  getHistory(symbol: string, range: HistoryRange): Effect.Effect<StockHistoryResponse, FugleHistoryError> {
    return Effect.gen(function* () {
      const apiKey = process.env.FUGLE_API_KEY;
      if (!apiKey) {
        return yield* new FugleHistoryConfigError();
      }

      const nowMs = yield* Clock.currentTimeMillis;
      const window = historyWindow(range, nowMs);
      const query = new URLSearchParams({
        timeframe: 'D',
        fields: 'open,high,low,close,volume',
        sort: 'asc',
        from: window.from,
        to: window.to,
      });
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(`${FUGLE_CANDLES_URL}/${encodeURIComponent(symbol)}?${query}`, {
            headers: { 'X-API-KEY': apiKey },
            signal,
          }),
        catch: () => new FugleHistoryNetworkError(),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
          onTimeout: () => new FugleHistoryTimeoutError(),
        }),
      );
      if (!response.ok) {
        return yield* new FugleHistoryHttpError({ status: response.status });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new FugleHistoryDecodeError(),
      });
      const history = yield* Schema.decodeUnknown(FugleHistorySchema)(raw).pipe(
        Effect.mapError(() => new FugleHistoryDecodeError()),
      );

      // Ascending is requested upstream, but the contract guarantee must not
      // depend on it: sort defensively (yyyy-MM-dd sorts lexicographically).
      const candles = [...history.data]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((candle) => ({
          date: candle.date,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        }));
      return yield* Schema.decodeUnknown(StockHistoryResponseSchema)({
        symbol: history.symbol,
        market: history.exchange === 'TWSE' ? 'TWSE' : 'TPEX',
        range,
        candles,
      }).pipe(Effect.mapError(() => new FugleHistoryDecodeError()));
    });
  }
}
