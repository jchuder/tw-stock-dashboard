import type { HistoryRange } from '@tw-stock-dashboard/contracts';

export interface HistoryWindow {
  from: string;
  to: string;
}

const RANGE_MONTHS: Record<'1m' | '3m' | '6m' | '1y', number> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '1y': 12,
};

// Last-N actual trading days per intraday range. The provider window below is
// deliberately wider in calendar days so weekends and holidays never starve
// the crop: the service keeps the last N trading dates present in the data,
// not the last N calendar days.
export const INTRADAY_TRADING_DAYS: Record<'1d' | '3d' | '5d', number> = {
  '1d': 1,
  '3d': 3,
  '5d': 5,
};

// Calendar lookback per intraday range. 5 trading days can span 9+ calendar
// days across a long weekend plus holidays; 21 days always covers that while
// staying far inside the 5m history start (2023-05-23).
const INTRADAY_LOOKBACK_CALENDAR_DAYS: Record<'1d' | '3d' | '5d', number> = {
  '1d': 7,
  '3d': 14,
  '5d': 21,
};

// MA60 needs up to 59 trading sessions before the first visible candle. Four
// calendar months always cover that on TWSE/TPEx calendars; missing sessions
// simply yield null MAs instead of guessed data.
export const WARMUP_MONTHS = 4;

// Fugle rejects a historical-candles window of exactly one year or more, so
// provider queries are split into chunks no longer than this. 350 days keeps
// every chunk safely under the limit while minimizing request count.
export const MAX_CHUNK_SPAN_DAYS = 350;

export function isIntradayRange(range: HistoryRange): range is '1d' | '3d' | '5d' {
  return range === '1d' || range === '3d' || range === '5d';
}

// Pure calendar math. `to` is the Asia/Taipei calendar date of now — never the
// UTC date, or a post-midnight Taipei request lands on yesterday. Daily ranges
// go back whole calendar months with month-end clamp (Mar 31 - 1m ->
// Feb 28/29); intraday ranges go back a fixed calendar-day lookback wide
// enough to always contain the last N trading days. 1Y is a full 12 calendar
// months — never shortened to fit the provider limit; chunking handles that.
// No date library: Intl formats the Taipei parts, the rest is arithmetic.
export function historyWindow(range: HistoryRange, nowMs: number): HistoryWindow {
  const to = taipeiParts(nowMs);
  const toStr = formatDate(to);
  if (isIntradayRange(range)) {
    return { from: shiftDays(toStr, -INTRADAY_LOOKBACK_CALENDAR_DAYS[range]), to: toStr };
  }
  return { from: shiftMonth(to, -RANGE_MONTHS[range]), to: toStr };
}

// String form of the same shift, for deriving the provider window from a
// visible `from` date. Never exposed as a public query parameter.
export function shiftCalendarMonths(date: string, deltaMonths: number): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  return shiftMonth({ year, month, day }, deltaMonths);
}

export function shiftCalendarDays(date: string, deltaDays: number): string {
  return shiftDays(date, deltaDays);
}

export function taipeiToday(nowMs: number): string {
  return formatDate(taipeiParts(nowMs));
}

// Split [from, to] into consecutive non-overlapping windows, each spanning at
// most MAX_CHUNK_SPAN_DAYS, so every provider query satisfies the Fugle
// <1-year rule while the union still covers the full requested span. The
// single-window fast path returns the input unchanged.
export function splitQueryWindows(from: string, to: string): HistoryWindow[] {
  if (spanDays(from, to) <= MAX_CHUNK_SPAN_DAYS) {
    return [{ from, to }];
  }
  const windows: HistoryWindow[] = [];
  let start = from;
  while (spanDays(start, to) > MAX_CHUNK_SPAN_DAYS) {
    const end = shiftDays(start, MAX_CHUNK_SPAN_DAYS);
    windows.push({ from: start, to: end });
    start = shiftDays(end, 1);
  }
  windows.push({ from: start, to });
  return windows;
}

// Merge candle lists from chunked/intraday provider queries: dedupe by the
// raw date key (later queries win on overlap), chronological sort. Pure and
// total — the service computes MAs on the merged set before cropping.
export function mergeCandles<T extends { date: string }>(lists: ReadonlyArray<ReadonlyArray<T>>): T[] {
  const byDate = new Map<string, T>();
  for (const list of lists) {
    for (const candle of list) {
      byDate.set(candle.date, candle);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Keep only candles whose Asia/Taipei trading date is among the last N
// trading dates present in the data. 5m candle dates are ISO instants with a
// +08:00 offset, so the first 10 chars are already the trading date. A
// weekend `to` simply yields the previous sessions — never an empty range
// when history exists.
export function cropToLastTradingDays<T extends { date: string }>(candles: ReadonlyArray<T>, tradingDays: number): T[] {
  const dates: string[] = [];
  const seen = new Set<string>();
  for (const candle of candles) {
    const day = candle.date.slice(0, 10);
    if (!seen.has(day)) {
      seen.add(day);
      dates.push(day);
    }
  }
  const keep = new Set(dates.slice(-tradingDays));
  return candles.filter((candle) => keep.has(candle.date.slice(0, 10)));
}

interface YearMonthDay {
  year: number;
  month: number;
  day: number;
}

const TAIPEI_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function taipeiParts(nowMs: number): YearMonthDay {
  const [year, month, day] = TAIPEI_FORMAT.format(new Date(nowMs))
    .split('-')
    .map((part) => Number(part));
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonth(date: YearMonthDay, deltaMonths: number): string {
  let year = date.year;
  let month = date.month + deltaMonths;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  const day = Math.min(date.day, daysInMonth(year, month));
  return formatDate({ year, month, day });
}

function shiftDays(date: string, deltaDays: number): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const ms = Date.UTC(year, month - 1, day) + deltaDays * 86_400_000;
  const d = new Date(ms);
  return formatDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function formatDate(date: YearMonthDay): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}
