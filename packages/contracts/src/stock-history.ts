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

export const StockHistoryResponseSchema = Schema.Struct({
  symbol: Schema.String,
  market: MarketSchema,
  range: HistoryRangeSchema,
  timeframe: TimeframeSchema,
  candles: Schema.Array(CandleSchema),
});
export type StockHistoryResponse = Schema.Schema.Type<typeof StockHistoryResponseSchema>;
