import { Inject, Injectable } from '@nestjs/common';
import { Duration, Effect, Either, Schema } from 'effect';
import { StockQuoteSchema } from '@tw-stock-dashboard/contracts';
import { WindowCacheService } from '../../libs/cache/window-cache.service.js';
import { OFFICIAL_QUOTE_POLICY, officialQuoteKey } from '../../libs/cache/window-cache.policies.js';
import {
  OfficialDailyQuoteError,
  type OfficialDailyQuoteMarket,
} from './official-daily-quote.error.js';
import type { QuoteProviderResult } from './quote-provider.js';
import {
  OfficialTpexDailySnapshotSchema,
  OfficialTwseDailySnapshotSchema,
  type OfficialTpexDailyRow,
  type OfficialTwseDailyRow,
} from './official-daily-quote.schema.js';
import { UPSTREAM_TIMEOUT_MS } from './upstream-timeout.js';

export const TWSE_DAILY_QUOTE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
export const TPEX_DAILY_QUOTE_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
type DailySnapshot = ReadonlyArray<OfficialTwseDailyRow> | ReadonlyArray<OfficialTpexDailyRow>;
interface DailyQuoteFields {
  readonly symbol: string;
  readonly market: OfficialDailyQuoteMarket;
  readonly name: string | null;
  readonly price: number | null;
  readonly change: number | null;
  readonly tradeDate: string | null;
  readonly openPrice: number | null;
  readonly highPrice: number | null;
  readonly lowPrice: number | null;
  readonly tradeVolume: number | null;
}

// Public Data Mode uses one official daily snapshot per exchange. All symbols
// share one coordinated 30-second window snapshot per market: the distributed
// lock replaces the old process-local singleflight across tabs and instances.
@Injectable()
export class OfficialDailyQuoteProvider {
  constructor(@Inject(WindowCacheService) private readonly windows: WindowCacheService) {}

  getQuote(
    symbol: string,
    market: OfficialDailyQuoteMarket,
  ): Effect.Effect<QuoteProviderResult, OfficialDailyQuoteError> {
    return Effect.gen(this, function* () {
      if (market === 'TWSE') {
        const snapshot = yield* this.getSnapshot(market);
        const entry = snapshot.find((row) => row.Code.trim() === symbol);
        if (!entry) {
          return yield* new OfficialDailyQuoteError({ market, stage: 'value' });
        }
        return yield* this.decodeQuote({
          symbol,
          market,
          name: cleanText(entry.Name),
          price: parseNumber(entry.ClosingPrice),
          change: parseNumber(entry.Change),
          tradeDate: parseRocDate(entry.Date),
          openPrice: parseNumber(entry.OpeningPrice),
          highPrice: parseNumber(entry.HighestPrice),
          lowPrice: parseNumber(entry.LowestPrice),
          tradeVolume: toLots(parseNumber(entry.TradeVolume)),
        });
      }

      const snapshot = yield* this.getSnapshot(market);
      const entry = snapshot.find((row) => row.SecuritiesCompanyCode.trim() === symbol);
      if (!entry) {
        return yield* new OfficialDailyQuoteError({ market, stage: 'value' });
      }
      return yield* this.decodeQuote({
        symbol,
        market,
        name: cleanText(entry.CompanyName),
        price: parseNumber(entry.Close),
        change: parseNumber(entry.Change),
        tradeDate: parseRocDate(entry.Date),
        openPrice: parseNumber(entry.Open),
        highPrice: parseNumber(entry.High),
        lowPrice: parseNumber(entry.Low),
        tradeVolume: toLots(parseNumber(entry.TradingShares)),
      });
    });
  }

  private getSnapshot(
    market: 'TWSE',
  ): Effect.Effect<ReadonlyArray<OfficialTwseDailyRow>, OfficialDailyQuoteError>;
  private getSnapshot(
    market: 'TPEX',
  ): Effect.Effect<ReadonlyArray<OfficialTpexDailyRow>, OfficialDailyQuoteError>;
  private getSnapshot(market: OfficialDailyQuoteMarket): Effect.Effect<DailySnapshot, OfficialDailyQuoteError> {
    return Effect.gen(this, function* () {
      const coordinated = yield* this.windows
        .getOrLoad({
          key: officialQuoteKey(market),
          policy: OFFICIAL_QUOTE_POLICY,
          decode: (raw) => parseSnapshot(raw, market),
          load: () => this.fetchSnapshot(market),
        })
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof OfficialDailyQuoteError
              ? cause
              : new OfficialDailyQuoteError({ market, stage: 'cache' as const }),
          ),
        );
      return coordinated.value;
    });
  }

  private fetchSnapshot(market: OfficialDailyQuoteMarket): Effect.Effect<DailySnapshot, OfficialDailyQuoteError> {
    const url = market === 'TWSE' ? TWSE_DAILY_QUOTE_URL : TPEX_DAILY_QUOTE_URL;
    return Effect.gen(this, function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(url, { signal, headers: { Accept: 'application/json' } }),
        catch: () => new OfficialDailyQuoteError({ market, stage: 'network' }),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
          onTimeout: () => new OfficialDailyQuoteError({ market, stage: 'timeout' }),
        }),
      );
      if (!response.ok) {
        return yield* new OfficialDailyQuoteError({ market, stage: 'http' });
      }

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new OfficialDailyQuoteError({ market, stage: 'decode' }),
      });
      const snapshot = parseSnapshot(raw, market);
      if (snapshot === null) {
        return yield* new OfficialDailyQuoteError({ market, stage: 'decode' });
      }
      return snapshot;
    });
  }

  private decodeQuote(fields: DailyQuoteFields): Effect.Effect<QuoteProviderResult, OfficialDailyQuoteError> {
    const { market, symbol, name, price, change, tradeDate } = fields;
    if (name === null || price === null || price <= 0 || change === null || tradeDate === null) {
      return Effect.fail(new OfficialDailyQuoteError({ market, stage: 'value' }));
    }

    const referencePrice = round2(price - change);
    if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
      return Effect.fail(new OfficialDailyQuoteError({ market, stage: 'value' }));
    }

    const quote = Schema.decodeUnknown(StockQuoteSchema)({
      symbol,
      name,
      market,
      price,
      referencePrice,
      referencePriceType: 'previous_close' as const,
      change: round2(change),
      changePercent: round2((change / referencePrice) * 100),
      tradeDate,
      openPrice: fields.openPrice,
      highPrice: fields.highPrice,
      lowPrice: fields.lowPrice,
      tradeVolume: fields.tradeVolume,
      tradeVolumeUnit: 'lot' as const,
      // These endpoints do not expose the current session's ground-truth
      // limits consistently; null is safer than deriving or using next-day values.
      limitUpPrice: null,
      limitDownPrice: null,
    }).pipe(Effect.mapError(() => new OfficialDailyQuoteError({ market, stage: 'decode' })));

    return Effect.map(quote, (normalized) => ({ quote: normalized, asOf: null }));
  }
}

function parseSnapshot(value: unknown, market: 'TWSE'): ReadonlyArray<OfficialTwseDailyRow> | null;
function parseSnapshot(value: unknown, market: 'TPEX'): ReadonlyArray<OfficialTpexDailyRow> | null;
function parseSnapshot(value: unknown, market: OfficialDailyQuoteMarket): DailySnapshot | null;
function parseSnapshot(value: unknown, market: OfficialDailyQuoteMarket): DailySnapshot | null {
  if (market === 'TWSE') {
    const decoded = Schema.decodeUnknownEither(OfficialTwseDailySnapshotSchema)(value);
    if (Either.isLeft(decoded) || decoded.right.length === 0) {
      return null;
    }
    return decoded.right;
  }
  const decoded = Schema.decodeUnknownEither(OfficialTpexDailySnapshotSchema)(value);
  if (Either.isLeft(decoded) || decoded.right.length === 0) {
    return null;
  }
  return decoded.right;
}

function cleanText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().replace(/,/g, '');
  if (/^X0(?:\.0+)?$/i.test(normalized)) {
    return 0;
  }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRocDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().replace(/\//g, '');
  const roc = /^(\d{3})(\d{2})(\d{2})$/.exec(normalized);
  const ymd = /^(\d{4})(\d{2})(\d{2})$/.exec(normalized);
  const year = roc ? Number(roc[1]) + 1911 : ymd ? Number(ymd[1]) : NaN;
  const month = Number((roc ?? ymd)?.[2]);
  const day = Number((roc ?? ymd)?.[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toLots(shares: number | null): number | null {
  return shares === null || shares < 0 ? null : shares / 1000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
