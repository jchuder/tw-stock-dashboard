import { Injectable } from '@nestjs/common';
import { Duration, Effect, Schema } from 'effect';
import { StockQuoteSchema } from '@tw-stock-dashboard/contracts';
import type { QuoteProvider, QuoteProviderResult } from './quote-provider.js';
import { epochMsToIsoOrNull } from './timestamp.js';
import { TwseMisDecodeError, TwseMisHttpError, TwseMisNetworkError, TwseMisTimeoutError } from './twse-mis-quote.error.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import {
  TwseMisEntrySchema,
  TwseMisQuoteSchema,
  parseFiniteNumber,
  parseMisSessionTime,
  parseMisTradeDate,
  round2,
} from './twse-mis-quote.schema.js';
import { UPSTREAM_TIMEOUT_MS } from './upstream-timeout.js';

// MIS quote result with the normalized session time. Public Data Mode needs
// it to prove a completed close; the base provider contract stays untouched.
export interface TwseMisQuoteResult extends QuoteProviderResult {
  readonly sessionTime: string | null;
}

const TWSE_MIS_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

@Injectable()
export class TwseMisQuoteProvider implements QuoteProvider<TwseMisQuoteError> {
  getQuote(symbol: string): Effect.Effect<TwseMisQuoteResult, TwseMisQuoteError> {
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
      const rawEntry = mis.msgArray.find(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && (item as { c?: unknown }).c === symbol,
      );
      if (!rawEntry) {
        return yield* new TwseMisDecodeError({ stage: 'value' });
      }
      const entry = yield* Schema.decodeUnknown(TwseMisEntrySchema)(rawEntry).pipe(
        Effect.mapError(() => new TwseMisDecodeError({ stage: 'schema' })),
      );

      const price = parseFiniteNumber(entry.z);
      const referencePrice = parseFiniteNumber(entry.y);
      if (price === null || referencePrice === null || referencePrice <= 0) {
        return yield* new TwseMisDecodeError({ stage: 'value' });
      }

      // Enriched session fields are best-effort: `-`/absent/invalid degrade
      // to null. Limit prices come only from u/w — never computed.
      const quote = yield* Schema.decodeUnknown(StockQuoteSchema)({
        symbol: entry.c,
        name: entry.n,
        market: entry.ex === 'tse' ? 'TWSE' : 'TPEX',
        price,
        referencePrice,
        referencePriceType: 'previous_close' as const,
        change: round2(price - referencePrice),
        changePercent: round2(((price - referencePrice) / referencePrice) * 100),
        tradeDate: parseMisTradeDate(entry.d),
        openPrice: entry.o === undefined ? null : parseFiniteNumber(entry.o),
        highPrice: entry.h === undefined ? null : parseFiniteNumber(entry.h),
        lowPrice: entry.l === undefined ? null : parseFiniteNumber(entry.l),
        tradeVolume: entry.v === undefined ? null : parseFiniteNumber(entry.v),
        // MIS v is natively lots (張), verified live against the daily share
        // count — same unit as the Fugle side, so no conversion.
        tradeVolumeUnit: 'lot' as const,
        limitUpPrice: entry.u === undefined ? null : parseFiniteNumber(entry.u),
        limitDownPrice: entry.w === undefined ? null : parseFiniteNumber(entry.w),
      }).pipe(Effect.mapError(() => new TwseMisDecodeError({ stage: 'schema' })));
      return { quote, asOf: toIsoOrNull(entry.tlong), sessionTime: parseMisSessionTime(entry.t) };
    });
  }
}

// MIS tlong is a runtime-observed epoch-milliseconds string, not a formal
// OpenAPI contract field. Malformed values degrade to null.
function toIsoOrNull(tlong: unknown): string | null {
  const ms = typeof tlong === 'number' ? tlong : typeof tlong === 'string' ? parseFiniteNumber(tlong) : null;
  if (ms === null) {
    return null;
  }
  return epochMsToIsoOrNull(ms);
}
