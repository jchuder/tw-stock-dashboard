import { Injectable } from '@nestjs/common';
import { Effect, Schema } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteResponseSchema } from '@tw-stock-dashboard/contracts';
import { FugleConfigError, FugleDecodeError, FugleHttpError, FugleNetworkError } from './fugle-quote.error.js';
import type { FugleQuoteError } from './fugle-quote.error.js';
import { FugleQuoteSchema } from './fugle-quote.schema.js';

const FUGLE_QUOTE_URL = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote';

@Injectable()
export class FugleQuoteProvider {
  getQuote(symbol: string): Effect.Effect<StockQuoteResponse, FugleQuoteError> {
    return Effect.gen(function* () {
      const apiKey = process.env.FUGLE_API_KEY;
      if (!apiKey) {
        return yield* new FugleConfigError();
      }

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${FUGLE_QUOTE_URL}/${encodeURIComponent(symbol)}`, {
            headers: { 'X-API-KEY': apiKey },
          }),
        catch: () => new FugleNetworkError(),
      });
      if (!response.ok) {
        return yield* new FugleHttpError({ status: response.status });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new FugleDecodeError({ stage: 'json' }),
      });
      const fugle = yield* Schema.decodeUnknown(FugleQuoteSchema)(raw).pipe(
        Effect.mapError(() => new FugleDecodeError({ stage: 'schema' })),
      );

      const normalized = yield* Schema.decodeUnknown(StockQuoteResponseSchema)({
        symbol: fugle.symbol,
        name: fugle.name,
        market: fugle.exchange === 'TWSE' ? 'TWSE' : 'TPEX',
        price: fugle.lastPrice,
        previousClose: fugle.previousClose,
        change: fugle.change,
        changePercent: fugle.changePercent,
      }).pipe(Effect.mapError(() => new FugleDecodeError({ stage: 'schema' })));
      return normalized;
    });
  }
}
