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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface ChartTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  isIntraday: boolean;
}

export function parseChartTimeParts(time: Time): ChartTimeParts | null {
  if (typeof time === 'string') {
    const match = time.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: match[4] ? Number(match[4]) : 0,
      minute: match[5] ? Number(match[5]) : 0,
      isIntraday: Boolean(match[4]),
    };
  }
  if (typeof time === 'object' && time !== null && 'year' in time) {
    return {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: 0,
      minute: 0,
      isIntraday: false,
    };
  }
  if (typeof time === 'number' && Number.isFinite(time)) {
    const d = new Date(time * 1000);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      isIntraday: true,
    };
  }
  return null;
}

export function formatChartCrosshairTime(time: Time, timeframe?: Timeframe): string {
  const parts = parseChartTimeParts(time);
  if (!parts) return '';
  const isIntraday = timeframe !== undefined ? timeframe === '5m' : parts.isIntraday;
  if (isIntraday) {
    return `${pad2(parts.month)}/${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
  }
  return `${parts.year}/${pad2(parts.month)}/${pad2(parts.day)}`;
}

export function formatChartTick(time: Time, timeframe?: Timeframe): string {
  const parts = parseChartTimeParts(time);
  if (!parts) return '';
  const isIntraday = timeframe !== undefined ? timeframe === '5m' : parts.isIntraday;
  if (isIntraday) {
    return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  }
  return `${pad2(parts.month)}/${pad2(parts.day)}`;
}
