import { describe, expect, it } from 'vitest';
import { applyMovingAverages } from './moving-average.js';
import type { BaseCandle } from './moving-average.js';

function makeCandles(closes: number[]): BaseCandle[] {
  return closes.map((close, i) => {
    const day = String(i + 1).padStart(2, '0');
    return {
      date: `2026-01-${day}`,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
    };
  });
}

describe('applyMovingAverages pure helper', () => {
  it('computes MA5 boundary correctly with 1,2,3,4,5 yielding 3 on 5th candle', () => {
    const candles = makeCandles([1, 2, 3, 4, 5]);
    const result = applyMovingAverages(candles);

    expect(result[0].ma5).toBeNull();
    expect(result[1].ma5).toBeNull();
    expect(result[2].ma5).toBeNull();
    expect(result[3].ma5).toBeNull();
    expect(result[4].ma5).toBe(3);
  });

  it('computes MA10 boundary correctly', () => {
    const closes = Array.from({ length: 11 }, (_, i) => i + 1);
    const result = applyMovingAverages(makeCandles(closes));

    expect(result[8].ma10).toBeNull(); // 9th candle
    expect(result[9].ma10).toBe(5.5); // 10th candle: avg(1..10) = 55/10 = 5.5
    expect(result[10].ma10).toBe(6.5); // 11th candle: avg(2..11) = 65/10 = 6.5
  });

  it('computes MA20 boundary correctly', () => {
    const closes = Array.from({ length: 21 }, () => 10);
    const result = applyMovingAverages(makeCandles(closes));

    expect(result[18].ma20).toBeNull(); // 19th candle
    expect(result[19].ma20).toBe(10); // 20th candle
    expect(result[20].ma20).toBe(10);
  });

  it('computes MA60 boundary correctly and handles insufficient history', () => {
    const closes = Array.from({ length: 60 }, (_, i) => (i < 59 ? 100 : 160));
    const result = applyMovingAverages(makeCandles(closes));

    expect(result[58].ma60).toBeNull(); // 59th candle
    // 60th candle: (59 * 100 + 160) / 60 = 6060 / 60 = 101
    expect(result[59].ma60).toBe(101);
  });

  it('rounds floating point averages to 2 decimal places', () => {
    const candles = makeCandles([10, 10, 10, 10, 11.555]);
    const result = applyMovingAverages(candles);
    expect(result[4].ma5).toBe(10.31);
  });
});
