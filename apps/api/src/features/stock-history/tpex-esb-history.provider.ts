import { Inject, Injectable } from '@nestjs/common';
import { Duration, Effect } from 'effect';
import type { Security } from '@tw-stock-dashboard/contracts';
import { CacheService } from '../../libs/cache/cache.service.js';
import { enumerateMonths } from './history-window.js';
import { OfficialDailyHistoryError } from './fugle-history.error.js';
import type { AverageBasisCandle } from './moving-average.js';
import { monthlyHistoryCacheKey, monthlyHistoryCacheTtl } from './official-daily-history.provider.js';

export const TPEX_ESB_HISTORICAL_URL = 'https://www.tpex.org.tw/www/zh-tw/emerging/historical';
const UPSTREAM_TIMEOUT_MS = 3000;
const ESB_ROW_LENGTH = 13;

export interface TpexEsbHistoryResult {
  symbol: string;
  market: 'ESB';
  provider: 'tpex-esb';
  candles: AverageBasisCandle[];
}

interface TpexEsbResponse {
  stat?: unknown;
  date?: unknown;
  tables?: Array<{ data?: unknown }>;
}

function parseRocDate(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ESB ROC date: ${String(value)}`);
  }
  const match = /^(\d{3})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  if (match === null) {
    throw new Error(`Invalid ESB ROC date: ${value}`);
  }
  const year = Number(match[1]) + 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ESB ROC date: ${value}`);
  }
  return `${year}-${match[2]}-${match[3]}`;
}

function parseFiniteNumber(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  const sanitized = text.replace(/,/g, '').trim();
  if (sanitized === '') {
    throw new Error(`Invalid ESB number: ${String(value)}`);
  }
  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ESB number: ${String(value)}`);
  }
  return parsed;
}

function parseNullablePrice(value: unknown): number | null {
  const parsed = parseFiniteNumber(value);
  return parsed === 0 ? null : parsed;
}

function parseRows(data: unknown, month: string): AverageBasisCandle[] {
  if (!Array.isArray(data)) {
    throw new Error('TPEx ESB returned an unexpected data shape');
  }

  return data.map((value) => {
    if (!Array.isArray(value) || value.length < ESB_ROW_LENGTH) {
      throw new Error('TPEx ESB returned an unexpected row shape');
    }

    const date = parseRocDate(value[0]);
    if (date.slice(0, 7).replace('-', '') !== month) {
      throw new Error(`TPEx ESB returned a row outside requested month ${month}: ${date}`);
    }

    const computerVolume = parseFiniteNumber(value[1]);
    const negotiatedVolume = parseFiniteNumber(value[7]);
    const hasComputerPrices = computerVolume > 0;

    return {
      date,
      open: null,
      high: hasComputerPrices ? parseNullablePrice(value[3]) : null,
      low: hasComputerPrices ? parseNullablePrice(value[4]) : null,
      close: null,
      average: hasComputerPrices ? parseNullablePrice(value[5]) : null,
      volume: computerVolume + negotiatedVolume,
    };
  });
}

function dedupeAndSort(candles: AverageBasisCandle[]): AverageBasisCandle[] {
  const byDate = new Map<string, AverageBasisCandle>();
  for (const candle of candles) {
    byDate.set(candle.date, candle);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function parseCachedCandles(value: unknown): AverageBasisCandle[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (
    !value.every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const candle = item as Record<string, unknown>;
      const nullableFinite = (field: unknown): field is number | null =>
        field === null || (typeof field === 'number' && Number.isFinite(field));
      return (
        typeof candle.date === 'string' &&
        candle.open === null &&
        nullableFinite(candle.high) &&
        nullableFinite(candle.low) &&
        candle.close === null &&
        nullableFinite(candle.average) &&
        typeof candle.volume === 'number' &&
        Number.isFinite(candle.volume)
      );
    })
  ) {
    return undefined;
  }
  return value as AverageBasisCandle[];
}

@Injectable()
export class TpexEsbHistoryProvider {
  constructor(@Inject(CacheService) private readonly cache: CacheService) {}

  getDailyHistory(
    security: Security,
    from: string,
    to: string,
  ): Effect.Effect<TpexEsbHistoryResult, OfficialDailyHistoryError> {
    const months = enumerateMonths(from, to);
    if (months.length === 0) {
      return Effect.fail(new OfficialDailyHistoryError({ cause: 'empty months' }));
    }

    return Effect.gen(this, function* () {
      if (security.market !== 'ESB') {
        return yield* new OfficialDailyHistoryError({ cause: 'ESB provider received a non-ESB security' });
      }

      const chunkResults = yield* Effect.all(months.map((month) => this.fetchMonth(security.symbol, month)), {
        concurrency: 3,
      });
      return {
        symbol: security.symbol,
        market: 'ESB' as const,
        provider: 'tpex-esb' as const,
        candles: dedupeAndSort(chunkResults.flat()),
      };
    });
  }

  private fetchMonth(symbol: string, month: string): Effect.Effect<AverageBasisCandle[], OfficialDailyHistoryError> {
    const key = monthlyHistoryCacheKey('esb', symbol, month);
    return this.withMonthlyCache(key, month, this.fetchMonthUpstream(symbol, month));
  }

  private fetchMonthUpstream(
    symbol: string,
    month: string,
  ): Effect.Effect<AverageBasisCandle[], OfficialDailyHistoryError> {
    const yyyy = month.slice(0, 4);
    const mm = month.slice(4, 6);
    const requestedDate = `${yyyy}/${mm}/01`;
    const url = `${TPEX_ESB_HISTORICAL_URL}?code=${encodeURIComponent(symbol)}&date=${encodeURIComponent(requestedDate)}`;

    return Effect.tryPromise({
      try: async (signal) => {
        const res = await fetch(url, { signal });
        if (!res.ok) {
          throw new Error(`TPEx ESB returned HTTP ${res.status}`);
        }
        const json = (await res.json()) as TpexEsbResponse;
        const expectedResponseDate = `${month}01`;
        const data = json.tables?.[0]?.data;
        if (json.stat !== 'ok' || json.date !== expectedResponseDate || !Array.isArray(data)) {
          throw new Error('TPEx ESB returned an unexpected monthly response');
        }
        return parseRows(data, month);
      },
      catch: (cause) => new OfficialDailyHistoryError({ cause }),
    }).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
        onTimeout: () => new OfficialDailyHistoryError({ cause: 'timeout' }),
      }),
    );
  }

  private withMonthlyCache(
    key: string,
    month: string,
    upstream: Effect.Effect<AverageBasisCandle[], OfficialDailyHistoryError>,
  ): Effect.Effect<AverageBasisCandle[], OfficialDailyHistoryError> {
    return Effect.gen(this, function* () {
      const cached = parseCachedCandles(yield* this.cache.getJson(key));
      if (cached !== undefined) {
        return cached;
      }
      const candles = yield* upstream;
      yield* this.cache.setJson(key, candles, monthlyHistoryCacheTtl(month));
      return candles;
    });
  }
}
