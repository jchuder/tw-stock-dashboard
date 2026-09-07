import { Inject, Injectable } from '@nestjs/common';
import { Duration, Effect, Either, Schema } from 'effect';
import { StockQuoteSchema } from '@tw-stock-dashboard/contracts';
import { CacheService } from '../../libs/cache/cache.service.js';
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
export const OFFICIAL_DAILY_QUOTE_CACHE_TTL_SECONDS = 30;

const CACHE_KEYS: Record<OfficialDailyQuoteMarket, string> = {
  TWSE: 'official-quote:twse:v1',
  TPEX: 'official-quote:tpex:v1',
};

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

// Public Data Mode uses one official daily snapshot per exchange. The
// process-local singleflight prevents eight watchlist symbols from issuing
// eight identical full-market requests; Redis cache handles later requests.
@Injectable()
export class OfficialDailyQuoteProvider {
  private readonly snapshotRefresh: Partial<
    Record<OfficialDailyQuoteMarket, Promise<Either.Either<DailySnapshot, OfficialDailyQuoteError>>>
  > = {};

  constructor(@Inject(CacheService) private readonly cache: CacheService) {}

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
      const cached = yield* this.cache.getJson(CACHE_KEYS[market]);
      const parsed = parseSnapshot(cached, market);
      if (parsed !== null) {
        return parsed;
      }
      if (cached !== null) {
        yield* this.cache.del(CACHE_KEYS[market]);
      }
      return yield* this.refreshSnapshot(market);
    });
  }


  private refreshSnapshot(market: OfficialDailyQuoteMarket): Effect.Effect<DailySnapshot, OfficialDailyQuoteError> {
    const active = this.snapshotRefresh[market];
    const refresh =
      active ??
      (this.snapshotRefresh[market] = Effect.runPromise(Effect.either(this.fetchSnapshot(market))).finally(() => {
        delete this.snapshotRefresh[market];
      }));
    return Effect.promise(() => refresh).pipe(
      Effect.flatMap((result) => (Either.isRight(result) ? Effect.succeed(result.right) : Effect.fail(result.left))),
    );
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
      yield* this.cache.setJson(CACHE_KEYS[market], snapshot, OFFICIAL_DAILY_QUOTE_CACHE_TTL_SECONDS);
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
