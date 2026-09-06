import { describe, expect, it } from 'vitest';
import { cropToLastTradingDays, historyWindow, mergeCandles, shiftCalendarDays, shiftCalendarMonths, splitQueryWindows, WARMUP_MONTHS } from './history-window.js';

describe('historyWindow', () => {
  it('computes a 1m window ending on the Taipei calendar date', () => {
    // 2026-09-06T12:00:00+08:00
    const nowMs = Date.UTC(2026, 8, 6, 4, 0, 0);

    expect(historyWindow('1m', nowMs)).toEqual({ from: '2026-08-06', to: '2026-09-06' });
  });

  it('computes 3m and 6m windows', () => {
    const nowMs = Date.UTC(2026, 8, 6, 4, 0, 0);

    expect(historyWindow('3m', nowMs)).toEqual({ from: '2026-06-06', to: '2026-09-06' });
    expect(historyWindow('6m', nowMs)).toEqual({ from: '2026-03-06', to: '2026-09-06' });
  });

  it('clamps month-end: March 31 minus one month is February 28', () => {
    // 2026-03-31T00:00:00+08:00; 2026 is not a leap year.
    const nowMs = Date.UTC(2026, 2, 30, 16, 0, 0);

    expect(historyWindow('1m', nowMs)).toEqual({ from: '2026-02-28', to: '2026-03-31' });
  });

  it('clamps to February 29 in a leap year', () => {
    // 2024-03-31T00:00:00+08:00; 2024 is a leap year.
    const nowMs = Date.UTC(2024, 2, 30, 16, 0, 0);

    expect(historyWindow('1m', nowMs)).toEqual({ from: '2024-02-29', to: '2024-03-31' });
  });

  it('uses the Taipei date, not UTC, just after midnight', () => {
    // 2026-09-06T00:30:00+08:00 is still 2026-09-05 in UTC.
    const nowMs = Date.UTC(2026, 8, 5, 16, 30, 0);

    expect(historyWindow('1m', nowMs)).toEqual({ from: '2026-08-06', to: '2026-09-06' });
  });

  it('shifts calendar months backwards and clamps properly', () => {
    // 4 months back from 2026-08-06 is 2026-04-06
    expect(shiftCalendarMonths('2026-08-06', -WARMUP_MONTHS)).toBe('2026-04-06');
    // 4 months back across year boundary: 2026-02-15 -> 2025-10-15
    expect(shiftCalendarMonths('2026-02-15', -4)).toBe('2025-10-15');
    // Month-end clamp: May 31 minus 1 month is April 30
    expect(shiftCalendarMonths('2026-05-31', -1)).toBe('2026-04-30');
  });
  it('computes a full 12-month 1y window without shortening for the provider limit', () => {
    const nowMs = Date.UTC(2026, 8, 6, 4, 0, 0);

    expect(historyWindow('1y', nowMs)).toEqual({ from: '2025-09-06', to: '2026-09-06' });
  });

  it('computes intraday lookback windows wide enough to survive weekends', () => {
    const nowMs = Date.UTC(2026, 8, 6, 4, 0, 0);

    expect(historyWindow('1d', nowMs)).toEqual({ from: '2026-08-30', to: '2026-09-06' });
    expect(historyWindow('3d', nowMs)).toEqual({ from: '2026-08-23', to: '2026-09-06' });
    expect(historyWindow('5d', nowMs)).toEqual({ from: '2026-08-16', to: '2026-09-06' });
  });

  it('shifts calendar days across month boundaries', () => {
    expect(shiftCalendarDays('2026-09-06', -7)).toBe('2026-08-30');
    expect(shiftCalendarDays('2026-01-01', 1)).toBe('2026-01-02');
  });

  it('keeps short spans as a single chunk', () => {
    expect(splitQueryWindows('2026-04-06', '2026-08-06')).toEqual([{ from: '2026-04-06', to: '2026-08-06' }]);
  });

  it('splits a 1y warm-up span into contiguous sub-year chunks', () => {
    const chunks = splitQueryWindows('2025-04-06', '2026-08-06');

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].from).toBe('2025-04-06');
    expect(chunks[chunks.length - 1].to).toBe('2026-08-06');
    // Contiguous and non-overlapping.
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].from).toBe(shiftCalendarDays(chunks[i - 1].to, 1));
    }
    for (const chunk of chunks) {
      const span = (Date.parse(chunk.to) - Date.parse(chunk.from)) / 86_400_000;
      expect(span).toBeLessThan(365);
    }
  });

  it('merges chunked candles with dedupe and chronological sort', () => {
    const a = [
      { date: '2026-08-06', open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { date: '2026-08-05', open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    const b = [{ date: '2026-08-06', open: 2, high: 2, low: 2, close: 2, volume: 2 }];

    expect(mergeCandles([a, b]).map((c) => c.date)).toEqual(['2026-08-05', '2026-08-06']);
    expect(mergeCandles([a, b])[1].close).toBe(2);
  });

  it('crops 5m candles to the last N trading dates, ignoring weekends', () => {
    const candles = [
      { date: '2026-09-04T09:00:00.000+08:00', open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { date: '2026-09-07T09:00:00.000+08:00', open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { date: '2026-09-07T09:05:00.000+08:00', open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];

    expect(cropToLastTradingDays(candles, 1).map((c) => c.date)).toEqual([
      '2026-09-07T09:00:00.000+08:00',
      '2026-09-07T09:05:00.000+08:00',
    ]);
    expect(cropToLastTradingDays(candles, 3)).toHaveLength(3);
  });
});
