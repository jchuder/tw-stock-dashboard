import { Injectable } from '@nestjs/common';
import { Duration, Effect, Schema } from 'effect';
import { StockQuoteSchema } from '@tw-stock-dashboard/contracts';
import type { QuoteProvider, QuoteProviderResult } from './quote-provider.js';
import { TwseMisDecodeError, TwseMisHttpError, TwseMisNetworkError, TwseMisTimeoutError } from './twse-mis-quote.error.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { TwseMisQuoteSchema, parseFiniteNumber, round2 } from './twse-mis-quote.schema.js';
import { UPSTREAM_TIMEOUT_MS } from './upstream-timeout.js';

const TWSE_MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

@Injectable()
export class TwseMisQuoteProvider implements QuoteProvider<TwseMisQuoteError> {
  getQuote(symbol: string): Effect.Effect<QuoteProviderResult, TwseMisQuoteError> {
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

      const quote = yield* Schema.decodeUnknown(StockQuoteSchema)({
        symbol: entry.c,
        name: entry.n,
        market: entry.ex === 'tse' ? 'TWSE' : 'TPEX',
        price,
        previousClose,
        change: round2(price - previousClose),
        changePercent: round2(((price - previousClose) / previousClose) * 100),
      }).pipe(Effect.mapError(() => new TwseMisDecodeError({ stage: 'schema' })));
      return { quote, asOf: toIsoOrNull(entry.tlong) };
    });
  }
}

// MIS tlong is a runtime-observed epoch-milliseconds string, not a formal
// OpenAPI contract field. Malformed values degrade to null.
function toIsoOrNull(tlong: unknown): string | null {
  const ms = typeof tlong === 'number' ? tlong : typeof tlong === 'string' ? parseFiniteNumber(tlong) : null;
  if (ms === null || !Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  return new Date(ms).toISOString();
}
