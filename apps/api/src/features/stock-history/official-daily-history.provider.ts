import { Inject, Injectable } from '@nestjs/common';
import { Duration, Effect } from 'effect';
import type { Security } from '@tw-stock-dashboard/contracts';
import { CacheService } from '../../libs/cache/cache.service.js';
import type { BaseCandle } from './moving-average.js';
import { OfficialDailyHistoryError } from './fugle-history.error.js';
import { enumerateMonths, taipeiToday } from './history-window.js';

export const TWSE_STOCK_DAY_URL = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
export const TPEX_TRADING_STOCK_URL = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock';
export const HISTORY_CACHE_CURRENT_MONTH_TTL_SECONDS = 5 * 60;
export const HISTORY_CACHE_CLOSED_MONTH_TTL_SECONDS = 24 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 3000;

export function monthlyHistoryCacheKey(provider: 'twse' | 'tpex', symbol: string, month: string): string {
  return `history:${provider}:${symbol}:${month}`;
}

export function monthlyHistoryCacheTtl(month: string, nowMs = Date.now()): number {
  const currentMonth = taipeiToday(nowMs).slice(0, 7).replace('-', '');
  return month === currentMonth
    ? HISTORY_CACHE_CURRENT_MONTH_TTL_SECONDS
    : HISTORY_CACHE_CLOSED_MONTH_TTL_SECONDS;
}

function parseRocDate(rocDateStr: string): string {
  const trimmed = rocDateStr.trim();
  if (trimmed.length < 6) {
    throw new Error(`Invalid ROC date: ${rocDateStr}`);
  }
  const yearPart = trimmed.slice(0, trimmed.length - 4);
  const monthDay = trimmed.slice(trimmed.length - 4);
  const year = Number(yearPart) + 1911;
  const month = monthDay.slice(0, 2);
  const day = monthDay.slice(2, 4);
  return `${year}-${month}-${day}`;
}

function parseFiniteNumber(val: string): number {
  const sanitized = val.replace(/,/g, '').trim();
  if (sanitized === '') {
    throw new Error('Invalid finite number: empty string');
  }
  const num = Number(sanitized);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid finite number: ${val}`);
  }
  return num;
}

export interface OfficialDailyHistoryResult {
  symbol: string;
  market: 'TWSE' | 'TPEX';
  provider: 'twse' | 'tpex';
  candles: BaseCandle[];
}

function parseTwseRows(data: unknown): BaseCandle[] {
  if (!Array.isArray(data)) return [];
  const candles: BaseCandle[] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 7) continue;
    try {
      const date = parseRocDate(String(row[0]).replace(/\//g, ''));
      const open = parseFiniteNumber(String(row[3]));
      const high = parseFiniteNumber(String(row[4]));
      const low = parseFiniteNumber(String(row[5]));
      const close = parseFiniteNumber(String(row[6]));
      const volume = parseFiniteNumber(String(row[1]));
      candles.push({ date, open, high, low, close, volume });
    } catch {
      continue;
    }
  }
  return candles;
}

function parseTpexRows(data: unknown): BaseCandle[] {
  if (!Array.isArray(data)) return [];
  const candles: BaseCandle[] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 7) continue;
    try {
      const date = parseRocDate(String(row[0]).replace(/\//g, ''));
      const open = parseFiniteNumber(String(row[3]));
      const high = parseFiniteNumber(String(row[4]));
      const low = parseFiniteNumber(String(row[5]));
      const close = parseFiniteNumber(String(row[6]));
      const volumeLots = parseFiniteNumber(String(row[1]));
      const volume = volumeLots * 1000;
      candles.push({ date, open, high, low, close, volume });
    } catch {
      continue;
    }
  }
  return candles;
}

function dedupeAndSort(candles: BaseCandle[]): BaseCandle[] {
  const byDate = new Map<string, BaseCandle>();
  for (const candle of candles) {
    byDate.set(candle.date, candle);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
function parseCachedCandles(value: unknown): BaseCandle[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (
    !value.every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const candle = item as Record<string, unknown>;
      return (
        typeof candle.date === 'string' &&
        typeof candle.open === 'number' &&
        Number.isFinite(candle.open) &&
        typeof candle.high === 'number' &&
        Number.isFinite(candle.high) &&
        typeof candle.low === 'number' &&
        Number.isFinite(candle.low) &&
        typeof candle.close === 'number' &&
        Number.isFinite(candle.close) &&
        typeof candle.volume === 'number' &&
        Number.isFinite(candle.volume)
      );
    })
  ) {
    return undefined;
  }
  return value as BaseCandle[];
}

@Injectable()
export class OfficialDailyHistoryProvider {
  constructor(@Inject(CacheService) private readonly cache: CacheService) {}

  getDailyHistory(
    security: Security,
    from: string,
    to: string,
  ): Effect.Effect<OfficialDailyHistoryResult, OfficialDailyHistoryError> {
    const months = enumerateMonths(from, to);
    if (months.length === 0) {
      return Effect.fail(new OfficialDailyHistoryError({ cause: 'empty months' }));
    }

    return Effect.gen(this, function* () {
      if (security.market === 'ESB') {
        return yield* new OfficialDailyHistoryError({ cause: 'ESB history provider is not implemented in Phase 3a' });
      }

      const fetchMonth =
        security.market === 'TWSE'
          ? (month: string) => this.fetchTwseMonth(security.symbol, month)
          : (month: string) => this.fetchTpexMonth(security.symbol, month);
      const chunkResults = yield* Effect.all(months.map(fetchMonth), { concurrency: 3 });
      const merged = chunkResults.flat();
      const candles = dedupeAndSort(merged);
      return {
        symbol: security.symbol,
        market: security.market,
        provider: security.market === 'TWSE' ? ('twse' as const) : ('tpex' as const),
        candles,
      };
    });
  }

  private fetchTwseMonth(symbol: string, month: string): Effect.Effect<BaseCandle[], OfficialDailyHistoryError> {
    const key = monthlyHistoryCacheKey('twse', symbol, month);
    return this.withMonthlyCache(key, month, this.fetchTwseMonthUpstream(symbol, month));
  }

  private fetchTwseMonthUpstream(symbol: string, month: string): Effect.Effect<BaseCandle[], OfficialDailyHistoryError> {
    const url = `${TWSE_STOCK_DAY_URL}?date=${encodeURIComponent(month)}01&stockNo=${encodeURIComponent(symbol)}&response=json`;
    return Effect.tryPromise({
      try: async (signal) => {
        const res = await fetch(url, { signal });
        if (!res.ok) {
          throw new Error(`TWSE returned HTTP ${res.status}`);
        }
        const json = (await res.json()) as { stat?: string; data?: unknown };
        if (json.stat !== 'OK' || !Array.isArray(json.data)) {
          throw new Error('TWSE returned an unexpected monthly response');
        }
        return parseTwseRows(json.data);
      },
      catch: (cause) => new OfficialDailyHistoryError({ cause }),
    }).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
        onTimeout: () => new OfficialDailyHistoryError({ cause: 'timeout' }),
      }),
    );
  }

  private fetchTpexMonth(symbol: string, month: string): Effect.Effect<BaseCandle[], OfficialDailyHistoryError> {
    const key = monthlyHistoryCacheKey('tpex', symbol, month);
    return this.withMonthlyCache(key, month, this.fetchTpexMonthUpstream(symbol, month));
  }

  private fetchTpexMonthUpstream(symbol: string, month: string): Effect.Effect<BaseCandle[], OfficialDailyHistoryError> {
    const yyyy = month.slice(0, 4);
    const mm = month.slice(4, 6);
    const url = `${TPEX_TRADING_STOCK_URL}?date=${encodeURIComponent(`${yyyy}/${mm}/01`)}&code=${encodeURIComponent(symbol)}&response=json`;
    return Effect.tryPromise({
      try: async (signal) => {
        const res = await fetch(url, { signal });
        if (!res.ok) {
          throw new Error(`TPEx returned HTTP ${res.status}`);
        }
        const json = (await res.json()) as { stat?: string; tables?: Array<{ data?: unknown }> };
        const data = json.tables?.[0]?.data;
        if (json.stat !== 'ok' || !Array.isArray(data)) {
          throw new Error('TPEx returned an unexpected monthly response');
        }
        return parseTpexRows(data);
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
    upstream: Effect.Effect<BaseCandle[], OfficialDailyHistoryError>,
  ): Effect.Effect<BaseCandle[], OfficialDailyHistoryError> {
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
