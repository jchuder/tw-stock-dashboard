import type { Time, UTCTimestamp } from 'lightweight-charts';
import type { Timeframe } from '@tw-stock-dashboard/contracts';

// Taiwan has no DST: Asia/Taipei is always UTC+8. Lightweight-charts renders
// UTCTimestamps as-is in UTC, so a 5m wall-clock instant like
// 2026-09-04T09:00:00+08:00 must be shifted to the UTC instant that *reads*
// 09:00 (i.e. 09:00 UTC) for the axis and crosshair to show Taipei time.
// Daily candles stay `yyyy-MM-dd` business-day strings with no intraday axis.
export const TAIPEI_UTC_OFFSET_SECONDS = 8 * 3600;

export function toChartTime(date: string, timeframe: Timeframe): Time {
  if (timeframe === '1d' || !date.includes('T')) {
    return date as Time;
  }
  return (Math.floor(new Date(date).getTime() / 1000) + TAIPEI_UTC_OFFSET_SECONDS) as UTCTimestamp as Time;
}

export function isIntradayAxis(timeframe: Timeframe): boolean {
  return timeframe === '5m';
}
