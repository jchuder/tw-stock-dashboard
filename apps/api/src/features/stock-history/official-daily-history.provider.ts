import { Injectable } from '@nestjs/common';
import { Duration, Effect } from 'effect';
import type { BaseCandle } from './moving-average.js';
import {
  OfficialDailyHistoryError,
  StockHistoryNotFoundError,
} from './fugle-history.error.js';
import { enumerateMonths } from './history-window.js';

export const TWSE_STOCK_DAY_URL = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
export const TPEX_TRADING_STOCK_URL = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock';
const UPSTREAM_TIMEOUT_MS = 3000;

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

@Injectable()
export class OfficialDailyHistoryProvider {
  getDailyHistory(
    symbol: string,
    from: string,
    to: string,
  ): Effect.Effect<OfficialDailyHistoryResult, OfficialDailyHistoryError | StockHistoryNotFoundError> {
    const months = enumerateMonths(from, to);
    if (months.length === 0) {
      return Effect.fail(new OfficialDailyHistoryError({ cause: 'empty months' }));
    }

    return Effect.gen(this, function* () {
      const market = yield* this.resolveMarket(symbol, months);
      if (!market) {
        return yield* new StockHistoryNotFoundError({ symbol });
      }

      if (market === 'TWSE') {
        const chunkResults = yield* Effect.all(
          months.map((m) => this.fetchTwseMonth(symbol, m)),
          { concurrency: 3 },
        );
        const merged = chunkResults.flat();
        if (merged.length === 0) {
          return yield* new StockHistoryNotFoundError({ symbol });
        }
        return {
          symbol,
          market: 'TWSE' as const,
          provider: 'twse' as const,
          candles: dedupeAndSort(merged),
        };
      }

      const chunkResults = yield* Effect.all(
        months.map((m) => this.fetchTpexMonth(symbol, m)),
        { concurrency: 3 },
      );
      const merged = chunkResults.flat();
      if (merged.length === 0) {
        return yield* new StockHistoryNotFoundError({ symbol });
      }
      return {
        symbol,
        market: 'TPEX' as const,
        provider: 'tpex' as const,
        candles: dedupeAndSort(merged),
      };
    });
  }

  private resolveMarket(
    symbol: string,
    months: string[],
  ): Effect.Effect<'TWSE' | 'TPEX' | null, OfficialDailyHistoryError> {
    const probeMonths = [...months].reverse().slice(0, 3);
    return Effect.gen(this, function* () {
      for (const month of probeMonths) {
        const [twseHas, tpexHas] = yield* Effect.all(
          [this.checkTwseSymbol(symbol, month), this.checkTpexSymbol(symbol, month)],
          { concurrency: 2 },
        );
        if (twseHas) return 'TWSE';
        if (tpexHas) return 'TPEX';
      }
      return null;
    });
  }

  private checkTwseSymbol(symbol: string, month: string): Effect.Effect<boolean, OfficialDailyHistoryError> {
    const url = `${TWSE_STOCK_DAY_URL}?date=${encodeURIComponent(month)}01&stockNo=${encodeURIComponent(symbol)}&response=json`;
    return Effect.tryPromise({
      try: async (signal) => {
        const res = await fetch(url, { signal });
        if (!res.ok) {
          if (res.status === 404) return false;
          throw new Error(`TWSE returned HTTP ${res.status}`);
        }
        const json = (await res.json()) as { stat?: string; data?: unknown };
        return json.stat === 'OK' && Array.isArray(json.data) && json.data.length > 0;
      },
      catch: (cause) => new OfficialDailyHistoryError({ cause }),
    }).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(UPSTREAM_TIMEOUT_MS),
        onTimeout: () => new OfficialDailyHistoryError({ cause: 'timeout' }),
      }),
    );
  }

  private fetchTwseMonth(symbol: string, month: string): Effect.Effect<BaseCandle[], OfficialDailyHistoryError> {
    const url = `${TWSE_STOCK_DAY_URL}?date=${encodeURIComponent(month)}01&stockNo=${encodeURIComponent(symbol)}&response=json`;
    return Effect.tryPromise({
      try: async (signal) => {
        const res = await fetch(url, { signal });
        if (!res.ok) {
          throw new Error(`TWSE returned HTTP ${res.status}`);
        }
        const json = (await res.json()) as { stat?: string; data?: unknown };
        if (json.stat !== 'OK' || !Array.isArray(json.data)) return [];
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

  private checkTpexSymbol(symbol: string, month: string): Effect.Effect<boolean, OfficialDailyHistoryError> {
    const yyyy = month.slice(0, 4);
    const mm = month.slice(4, 6);
    const url = `${TPEX_TRADING_STOCK_URL}?date=${encodeURIComponent(`${yyyy}/${mm}/01`)}&code=${encodeURIComponent(symbol)}&response=json`;
    return Effect.tryPromise({
      try: async (signal) => {
        const res = await fetch(url, { signal });
        if (!res.ok) {
          if (res.status === 404) return false;
          throw new Error(`TPEx returned HTTP ${res.status}`);
        }
        const json = (await res.json()) as { stat?: string; tables?: Array<{ data?: unknown }> };
        const data = json.tables?.[0]?.data;
        return json.stat === 'ok' && Array.isArray(data) && data.length > 0;
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
        if (json.stat !== 'ok' || !Array.isArray(data)) return [];
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
}
