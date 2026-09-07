// Provider-internal candle: upstream TWSE/TPEX/Fugle daily rows always carry
// full OHLC numbers (rows that fail parsing are skipped before this point).
export interface BaseCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ESB official history is average-price based. Its first-group high/low and
// average may be absent on days that only have second-group volume.
export interface AverageBasisCandle {
  date: string;
  open: null;
  high: number | null;
  low: number | null;
  close: null;
  average: number | null;
  volume: number;
}

type MovingAverageFields = {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
};

export type CandleWithMa = BaseCandle & MovingAverageFields;
export type AverageCandleWithMa = AverageBasisCandle & MovingAverageFields;

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

// Average-basis MAs use the latest N valid average observations, skipping
// null-average days. A null current observation never receives an MA.
export function applyAverageMovingAverages(
  candles: ReadonlyArray<AverageBasisCandle>,
): AverageCandleWithMa[] {
  return candles.map((candle, index) => ({
    ...candle,
    ma5: averageValidAverage(candles, index, 5),
    ma10: averageValidAverage(candles, index, 10),
    ma20: averageValidAverage(candles, index, 20),
    ma60: averageValidAverage(candles, index, 60),
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

function averageValidAverage(
  candles: ReadonlyArray<AverageBasisCandle>,
  index: number,
  period: number,
): number | null {
  if (candles[index].average === null) {
    return null;
  }

  let count = 0;
  let sum = 0;
  for (let i = index; i >= 0 && count < period; i -= 1) {
    const value = candles[i].average;
    if (value === null) {
      continue;
    }
    sum += value;
    count += 1;
  }

  return count === period ? round2(sum / period) : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
