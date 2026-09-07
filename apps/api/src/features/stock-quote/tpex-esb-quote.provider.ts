import { Injectable } from '@nestjs/common';
import { Duration, Effect, Schema } from 'effect';
import { StockQuoteSchema } from '@tw-stock-dashboard/contracts';
import type { TpexEsbQuoteError } from './tpex-esb-quote.error.js';
import {
  TpexEsbDecodeError,
  TpexEsbHttpError,
  TpexEsbNetworkError,
  TpexEsbTimeoutError,
} from './tpex-esb-quote.error.js';
import type { QuoteProviderResult } from './quote-provider.js';
import { TpexEsbSnapshotSchema } from './tpex-esb-quote.schema.js';
import { UPSTREAM_TIMEOUT_MS } from './upstream-timeout.js';

export const TPEX_ESB_SNAPSHOT_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_statistics';

// TPEx ESB latest-statistics snapshot: one ~140KB full-market payload,
// filtered locally for the symbol. ESB is a negotiated quote-driven market
// with no close and no limit prices: referencePrice is the previous-day
// average (null when the official value is absent, e.g. listing day), and
// change figures are null alongside it — never 0-based. Volume is natively
// shares (股), matching the ESB daily 成交股數.
@Injectable()
export class TpexEsbQuoteProvider implements QuoteProvider<TpexEsbQuoteError> {
  getQuote(symbol: string): Effect.Effect<QuoteProviderResult, TpexEsbQuoteError> {
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(TPEX_ESB_SNAPSHOT_URL, { signal, headers: { Accept: 'application/json' } }),
        catch: () => new TpexEsbNetworkError(),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
          onTimeout: () => new TpexEsbTimeoutError(),
        }),
      );
      if (!response.ok) {
        return yield* new TpexEsbHttpError({ status: response.status });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new TpexEsbDecodeError({ stage: 'json' }),
      });
      const snapshot = yield* Schema.decodeUnknown(TpexEsbSnapshotSchema)(raw).pipe(
        Effect.mapError(() => new TpexEsbDecodeError({ stage: 'schema' })),
      );
      const entry = snapshot.find((row) => row.SecuritiesCompanyCode.trim() === symbol);
      if (!entry) {
        // The universe already proved the symbol exists: absence here means
        // no quote in today's snapshot (e.g. suspended), not non-existence.
        return yield* new TpexEsbDecodeError({ stage: 'value' });
      }

      const parsedPrice = parseEsbPrice(entry.LatestPrice);
      if (!parsedPrice.valid) {
        return yield* new TpexEsbDecodeError({ stage: 'value' });
      }
      const price = parsedPrice.value;
      const referencePrice = parseEsbReference(entry.PreviousAveragePrice);
      const highPrice = parseEsbPrice(entry.Highest).value;
      const lowPrice = parseEsbPrice(entry.Lowest).value;
      const change = price === null || referencePrice === null ? null : round2(price - referencePrice);
      const changePercent =
        price === null || referencePrice === null
          ? null
          : round2(((price - referencePrice) / referencePrice) * 100);

      const quote = yield* Schema.decodeUnknown(StockQuoteSchema)({
        symbol: entry.SecuritiesCompanyCode.trim(),
        name: entry.CompanyName.trim(),
        market: 'ESB' as const,
        price,
        referencePrice,
        referencePriceType: 'previous_average' as const,
        change,
        changePercent,
        tradeDate: parseRocDate(entry.Date),
        openPrice: null,
        highPrice,
        lowPrice,
        tradeVolume: parseEsbVolume(entry.TransactionVolume),
        tradeVolumeUnit: 'share' as const,
        limitUpPrice: null,
        limitDownPrice: null,
      }).pipe(Effect.mapError(() => new TpexEsbDecodeError({ stage: 'schema' })));
      return { quote, asOf: parseEsbDateTime(entry.Date, entry.Time) };
    });
  }
}

interface ParsedEsbPrice {
  value: number | null;
  valid: boolean;
}

function parseEsbPrice(raw: string): ParsedEsbPrice {
  const value = parseEsbNumber(raw);
  if (value === null) {
    return { value: null, valid: false };
  }
  return { value: value === 0 ? null : value, valid: true };
}

function parseEsbNumber(raw: string): number | null {
  const normalized = raw.replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// Previous-day average is '00000.0000'/zero when no valid reference exists
// (e.g. listing day): null, so change figures degrade to null with it.
function parseEsbReference(raw: string): number | null {
  const value = parseEsbNumber(raw);
  return value === null || value <= 0 ? null : value;
}

function parseEsbVolume(raw: string): number | null {
  const normalized = raw.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ESB snapshot dates are ROC `YYYMMDD` (e.g. "1150907"). Normalize to the
// contract `yyyy-MM-dd`; anything else degrades to null.
function parseRocDate(raw: string): string | null {
  const match = /^(\d{2,3})(\d{2})(\d{2})$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]) + 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return null;
  }
  const timestamp = Date.UTC(year, month, 0);
  const daysInMonth = new Date(timestamp).getUTCDate();
  if (day > daysInMonth) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Snapshot `Date` + `Time` (HHMMSS, Asia/Taipei wall clock) mark the latest
// quote state; surface as UTC ISO for the header freshness label.
function parseEsbDateTime(date: string, time: string): string | null {
  const day = parseRocDate(date);
  const clock = /^(\d{2})(\d{2})(\d{2})$/.exec(time.trim());
  if (day === null || !clock) {
    return null;
  }
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const second = Number(clock[3]);
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const [year, month, dom] = day.split('-').map(Number);
  const ms = Date.UTC(year, month - 1, dom, hour, minute, second) - 8 * 60 * 60 * 1000;
  const result = new Date(ms);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}
