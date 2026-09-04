import { Injectable } from '@nestjs/common';
import { Duration, Effect, Schema } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteResponseSchema } from '@tw-stock-dashboard/contracts';
import type { QuoteProvider } from './quote-provider.js';
import { TwseMisDecodeError, TwseMisHttpError, TwseMisNetworkError, TwseMisTimeoutError } from './twse-mis-quote.error.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { TwseMisQuoteSchema, parseFiniteNumber, round2 } from './twse-mis-quote.schema.js';
import { UPSTREAM_TIMEOUT_MS } from './upstream-timeout.js';

const TWSE_MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

@Injectable()
export class TwseMisQuoteProvider implements QuoteProvider<TwseMisQuoteError> {
  getQuote(symbol: string): Effect.Effect<StockQuoteResponse, TwseMisQuoteError> {
    return Effect.gen(function* () {
      // No stock-universe feature exists, so never guess the listing market:
      // query both tse_ and otc_ and pick the entry matching the symbol.
      const encoded = encodeURIComponent(symbol);
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(`${TWSE_MIS_URL}?ex_ch=tse_${encoded}.tw|otc_${encoded}.tw&json=1&delay=0`, { signal }),
        catch: () => new TwseMisNetworkError(),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
          onTimeout: () => new TwseMisTimeoutError(),
        }),
      );
      if (!response.ok) {
        return yield* new TwseMisHttpError({ status: response.status });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new TwseMisDecodeError({ stage: 'json' }),
      });
      const mis = yield* Schema.decodeUnknown(TwseMisQuoteSchema)(raw).pipe(
        Effect.mapError(() => new TwseMisDecodeError({ stage: 'schema' })),
      );
      const entry = mis.msgArray.find((item) => item.c === symbol);
      if (!entry) {
        return yield* new TwseMisDecodeError({ stage: 'value' });
      }

      const price = parseFiniteNumber(entry.z);
      const previousClose = parseFiniteNumber(entry.y);
      if (price === null || previousClose === null || previousClose <= 0) {
        return yield* new TwseMisDecodeError({ stage: 'value' });
      }

      const normalized = yield* Schema.decodeUnknown(StockQuoteResponseSchema)({
        symbol: entry.c,
        name: entry.n,
        market: entry.ex === 'tse' ? 'TWSE' : 'TPEX',
        price,
        previousClose,
        change: round2(price - previousClose),
        changePercent: round2(((price - previousClose) / previousClose) * 100),
      }).pipe(Effect.mapError(() => new TwseMisDecodeError({ stage: 'schema' })));
      return normalized;
    });
  }
}
