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
import { FugleIntradayCandlesSchema } from './fugle-intraday-candles.schema.js';
import type { FugleHistoryResult } from './fugle-history.schema.js';

const FUGLE_CANDLES_URL = 'https://api.fugle.tw/marketdata/v1.0/stock/historical/candles';
const FUGLE_INTRADAY_CANDLES_URL = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles';

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
    return this.getDaily(symbol, from, to);
  }

  getDaily(symbol: string, from: string, to: string): Effect.Effect<FugleHistoryResult, FugleHistoryError> {
    return this.getHistorical(symbol, from, to, 'D');
  }

  // Completed sessions at 5-minute resolution. The service merges this with
  // the current-session intraday candles for the 1D/3D/5D ranges.
  getHistorical5m(symbol: string, from: string, to: string): Effect.Effect<FugleHistoryResult, FugleHistoryError> {
    return this.getHistorical(symbol, from, to, '5');
  }

  // Current trading session at 5-minute resolution. No from/to: the endpoint
  // only serves today. A 404 (no session data — weekend/holiday/pre-open)
  // yields an empty candle list so the range still serves history; every
  // other failure propagates.
  getIntraday5m(symbol: string): Effect.Effect<FugleHistoryResult, FugleHistoryError> {
    return Effect.gen(function* () {
      const apiKey = process.env.FUGLE_API_KEY;
      if (!apiKey) {
        return yield* new FugleHistoryConfigError();
      }

      const query = new URLSearchParams({ timeframe: '5' });
      const response = yield* fetchUpstream(
        `${FUGLE_INTRADAY_CANDLES_URL}/${encodeURIComponent(symbol)}?${query}`,
        apiKey,
      );
      if (!response.ok) {
        if (response.status === 404) {
          return { symbol, market: 'TWSE' as const, candles: [] };
        }
        return yield* new FugleHistoryHttpError({ status: response.status });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new FugleHistoryDecodeError(),
      });
      const intraday = yield* Schema.decodeUnknown(FugleIntradayCandlesSchema)(raw).pipe(
        Effect.mapError(() => new FugleHistoryDecodeError()),
      );
      // A 200 with no rows (pre-open) is a valid empty session, not an error.
      if (intraday.data.length === 0) {
        return { symbol, market: 'TWSE' as const, candles: [] };
      }
      return {
        symbol: intraday.symbol,
        market: intraday.exchange === 'TWSE' ? 'TWSE' : 'TPEX',
        candles: [...intraday.data]
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
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

  private getHistorical(
    symbol: string,
    from: string,
    to: string,
    timeframe: 'D' | '5',
  ): Effect.Effect<FugleHistoryResult, FugleHistoryError> {
    return Effect.gen(function* () {
      const apiKey = process.env.FUGLE_API_KEY;
      if (!apiKey) {
        return yield* new FugleHistoryConfigError();
      }

      const query = new URLSearchParams({
        timeframe,
        fields: 'open,high,low,close,volume',
        sort: 'asc',
        from,
        to,
      });
      const response = yield* fetchUpstream(
        `${FUGLE_CANDLES_URL}/${encodeURIComponent(symbol)}?${query}`,
        apiKey,
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

function fetchUpstream(url: string, apiKey: string): Effect.Effect<Response, FugleHistoryError> {
  return Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
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
}
