import { Schema } from 'effect';
import { MarketSchema } from './stock-quote.js';

export const HistoryRangeSchema = Schema.Literal('1d', '3d', '5d', '1m', '3m', '6m', '1y');
export type HistoryRange = Schema.Schema.Type<typeof HistoryRangeSchema>;

export const CandleSchema = Schema.Struct({
  date: Schema.String,
  open: Schema.Number,
  high: Schema.Number,
  low: Schema.Number,
  close: Schema.Number,
  volume: Schema.Number,
  ma5: Schema.NullOr(Schema.Number),
  ma10: Schema.NullOr(Schema.Number),
  ma20: Schema.NullOr(Schema.Number),
  ma60: Schema.NullOr(Schema.Number),
});
export type Candle = Schema.Schema.Type<typeof CandleSchema>;

export const TimeframeSchema = Schema.Literal('5m', '1d');
export type Timeframe = Schema.Schema.Type<typeof TimeframeSchema>;

// Volume unit follows the provider ground truth, verified against live data
// (2330, 2026-09-04: daily 14102018 shares vs 5m/intraday 13169 lots):
// 5-minute candles trade in lots (張), daily candles in shares (股).
export const VolumeUnitSchema = Schema.Literal('lot', 'share');
export type VolumeUnit = Schema.Schema.Type<typeof VolumeUnitSchema>;

export const StockHistoryResponseSchema = Schema.Struct({
  symbol: Schema.String,
  market: MarketSchema,
  range: HistoryRangeSchema,
  timeframe: TimeframeSchema,
  volumeUnit: VolumeUnitSchema,
  candles: Schema.Array(CandleSchema),
});
export type StockHistoryResponse = Schema.Schema.Type<typeof StockHistoryResponseSchema>;
