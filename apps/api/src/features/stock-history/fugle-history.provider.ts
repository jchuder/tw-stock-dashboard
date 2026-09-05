import { Injectable } from '@nestjs/common';
import { Duration, Effect, Schema } from 'effect';
import type { FugleHistoryError } from './fugle-history.error.js';
import {
  FugleHistoryConfigError,
  FugleHistoryDecodeError,
  FugleHistoryHttpError,
  FugleHistoryNetworkError,
  FugleHistoryTimeoutError,
} from './fugle-history.error.js';
import { FugleHistorySchema } from './fugle-history.schema.js';
import type { FugleHistoryResult } from './fugle-history.schema.js';

const FUGLE_CANDLES_URL = 'https://api.fugle.tw/marketdata/v1.0/stock/historical/candles';

// Mirrors the stock-quote upstream budget (3s network fetch). Extract to a
// shared home on the third concrete usage, not before.
const UPSTREAM_TIMEOUT_MS = 3000;

// No shared HTTP client: second concrete usage with no shared behavior yet.
// A FugleClient waits for the third usage or a real shared need.
@Injectable()
export class FugleHistoryProvider {
  getHistory(
    symbol: string,
    from: string,
    to: string,
  ): Effect.Effect<FugleHistoryResult, FugleHistoryError> {
    return Effect.gen(function* () {
      const apiKey = process.env.FUGLE_API_KEY;
      if (!apiKey) {
        return yield* new FugleHistoryConfigError();
      }

      const query = new URLSearchParams({
        timeframe: 'D',
        fields: 'open,high,low,close,volume',
        sort: 'asc',
        from,
        to,
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
      return {
        symbol: history.symbol,
        market: history.exchange === 'TWSE' ? 'TWSE' : 'TPEX',
        candles: [...history.data]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((candle) => ({
            date: candle.date,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          })),
      };
    });
  }
}
