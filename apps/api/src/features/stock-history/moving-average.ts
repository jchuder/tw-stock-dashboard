// Provider-internal candle: upstream TWSE/TPEX/Fugle daily rows always carry
// full OHLC numbers (rows that fail parsing are skipped before this point).
// ESB average-basis candles arrive in Phase 3 with their own assembly; the
// contract Candle stays nullable at the boundary.
export interface BaseCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export type CandleWithMa = BaseCandle & {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
};

// Simple moving average of daily close over ascending candles. A candle
// carries its own window (including itself); fewer than N closes yields null.
// Results round to 2 decimals — plain arithmetic is plenty for ~10 months.
export function applyMovingAverages(candles: ReadonlyArray<BaseCandle>): CandleWithMa[] {
  return candles.map((candle, index) => ({
    ...candle,
    ma5: average(candles, index, 5),
    ma10: average(candles, index, 10),
    ma20: average(candles, index, 20),
    ma60: average(candles, index, 60),
  }));
}

function average(candles: ReadonlyArray<BaseCandle>, index: number, period: number): number | null {
  if (index + 1 < period) {
    return null;
  }
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) {
    sum += candles[i].close;
  }
  return round2(sum / period);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
