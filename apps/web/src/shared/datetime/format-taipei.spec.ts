import { describe, expect, it } from 'vitest';
import {
  formatTaipeiDate,
  formatTaipeiDateTime,
  formatTaipeiTime,
  getMarketOverviewRefetchInterval,
  isTaipeiTradingWindow,
} from './format-taipei.js';

describe('format-taipei', () => {
  it('formats an ISO instant as Taipei wall-clock YYYY/MM/DD HH:mm:ss', () => {
    expect(formatTaipeiDateTime('2026-09-04T05:30:05.000Z')).toBe('2026/09/04 13:30:05');
  });

  it('rolls the Taipei date forward past midnight UTC', () => {
    // 2026-09-04T16:30:00Z is already 2026-09-05 in Taipei.
    expect(formatTaipeiDateTime('2026-09-04T16:30:00.000Z')).toBe('2026/09/05 00:30:00');
  });

  it('formats an EOD date as slash-separated YYYY/MM/DD', () => {
    expect(formatTaipeiDate('2026-09-04')).toBe('2026/09/04');
  });

  it('formats intraday ISO as HH:mm:ss', () => {
    expect(formatTaipeiTime('2026-09-07T10:30:15+08:00')).toBe('10:30:15');
  });

  describe('isTaipeiTradingWindow', () => {
    it('returns true during weekday trading window (e.g. Mon 08:55 ~ 13:35)', () => {
      // Mon 08:55
      expect(isTaipeiTradingWindow(new Date('2026-09-07T08:55:00+08:00'))).toBe(true);
      // Mon 10:30
      expect(isTaipeiTradingWindow(new Date('2026-09-07T10:30:00+08:00'))).toBe(true);
      // Mon 13:35
      expect(isTaipeiTradingWindow(new Date('2026-09-07T13:35:00+08:00'))).toBe(true);
    });

    it('returns false outside weekday trading window', () => {
      // Mon 08:54
      expect(isTaipeiTradingWindow(new Date('2026-09-07T08:54:59+08:00'))).toBe(false);
      // Mon 13:36
      expect(isTaipeiTradingWindow(new Date('2026-09-07T13:36:00+08:00'))).toBe(false);
      // Mon 14:14
      expect(isTaipeiTradingWindow(new Date('2026-09-07T14:14:00+08:00'))).toBe(false);
    });

    it('returns false on weekends even during trading hours', () => {
      // Sat 10:00
      expect(isTaipeiTradingWindow(new Date('2026-09-05T10:00:00+08:00'))).toBe(false);
      // Sun 11:00
      expect(isTaipeiTradingWindow(new Date('2026-09-06T11:00:00+08:00'))).toBe(false);
    });
  });

  describe('getMarketOverviewRefetchInterval', () => {
    it('returns 30,000 ms during trading window', () => {
      const intradayNow = new Date('2026-09-07T10:30:00+08:00');
      expect(getMarketOverviewRefetchInterval(intradayNow)).toBe(30_000);
    });

    it('returns milliseconds until 08:55:00 on the same day when earlier in the morning', () => {
      // Mon 08:54:50 -> 10s until 08:55:00 (+200ms grace = 10,200ms)
      const morningNow = new Date('2026-09-07T08:54:50+08:00');
      const interval = getMarketOverviewRefetchInterval(morningNow);
      expect(interval).toBeGreaterThanOrEqual(10_000);
      expect(interval).toBeLessThanOrEqual(10_500);
    });

    it('returns milliseconds until next day 08:55:00 when after 13:35 on Monday to Thursday', () => {
      // Mon 14:00:00 -> until Tue 08:55:00 (18h 55m = 68,100,000 ms)
      const afterHoursMon = new Date('2026-09-07T14:00:00+08:00');
      const interval = getMarketOverviewRefetchInterval(afterHoursMon);
      expect(interval).toBeGreaterThan(18 * 3600 * 1000);
      expect(interval).toBeLessThan(19 * 3600 * 1000);
    });

    it('returns milliseconds until Monday 08:55:00 when after 13:35 on Friday', () => {
      // Fri 14:00:00 -> until Mon 08:55:00 (66h 55m = 240,900,000 ms)
      const afterHoursFri = new Date('2026-09-04T14:00:00+08:00');
      const interval = getMarketOverviewRefetchInterval(afterHoursFri);
      expect(interval).toBeGreaterThan(66 * 3600 * 1000);
      expect(interval).toBeLessThan(67 * 3600 * 1000);
    });

    it('returns milliseconds until Monday 08:55:00 when on weekend', () => {
      // Sat 10:00:00 -> until Mon 08:55:00 (46h 55m = 168,900,000 ms)
      const weekendSat = new Date('2026-09-05T10:00:00+08:00');
      const interval = getMarketOverviewRefetchInterval(weekendSat);
      expect(interval).toBeGreaterThan(46 * 3600 * 1000);
      expect(interval).toBeLessThan(47 * 3600 * 1000);
    });
  });
});
