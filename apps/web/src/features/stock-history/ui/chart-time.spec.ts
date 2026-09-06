import { describe, expect, it } from 'vitest';
import {
  formatChartCrosshairTime,
  formatChartTick,
  isIntradayAxis,
  TAIPEI_UTC_OFFSET_SECONDS,
  toChartTime,
} from './chart-time.js';

describe('chart-time', () => {
  it('keeps daily candles as business-day strings', () => {
    expect(toChartTime('2026-09-04', '1d')).toBe('2026-09-04');
  });

  it('normalizes a 5m Taipei instant to the UTC instant reading the same wall clock', () => {
    // 2026-09-04T09:00:00+08:00 is 01:00 UTC; the chart must show 09:00.
    const time = toChartTime('2026-09-04T09:00:00.000+08:00', '5m');

    expect(typeof time).toBe('number');
    const rendered = new Date((time as number) * 1000);
    expect(rendered.getUTCHours()).toBe(9);
    expect(rendered.getUTCMinutes()).toBe(0);
  });

  it('uses a fixed UTC+8 offset with no DST adjustment', () => {
    expect(TAIPEI_UTC_OFFSET_SECONDS).toBe(8 * 3600);

    const winter = toChartTime('2026-01-15T09:00:00.000+08:00', '5m') as number;
    const summer = toChartTime('2026-07-15T09:00:00.000+08:00', '5m') as number;
    expect(new Date(winter * 1000).getUTCHours()).toBe(9);
    expect(new Date(summer * 1000).getUTCHours()).toBe(9);
  });

  it('reports the intraday axis only for the 5m timeframe', () => {
    expect(isIntradayAxis('5m')).toBe(true);
    expect(isIntradayAxis('1d')).toBe(false);
  });

  it('formats tick and crosshair labels correctly for 5m intraday candles', () => {
    const time = toChartTime('2026-09-04T09:00:00.000+08:00', '5m');
    expect(formatChartTick(time, '5m')).toBe('09:00');
    expect(formatChartCrosshairTime(time, '5m')).toBe('09/04 09:00');
  });

  it('formats tick and crosshair labels correctly for 1d daily candles', () => {
    const time = toChartTime('2026-09-04', '1d');
    expect(formatChartTick(time, '1d')).toBe('09/04');
    expect(formatChartCrosshairTime(time, '1d')).toBe('2026/09/04');
  });
});

