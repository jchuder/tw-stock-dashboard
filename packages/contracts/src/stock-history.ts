import { Schema } from 'effect';
import { MarketSchema } from './stock-quote.js';

export const HistoryRangeSchema = Schema.Literal('1m', '3m', '6m');
export type HistoryRange = Schema.Schema.Type<typeof HistoryRangeSchema>;

export const CandleSchema = Schema.Struct({
  date: Schema.String,
  open: Schema.Number,
  high: Schema.Number,
  low: Schema.Number,
  close: Schema.Number,
  volume: Schema.Number,
});
export type Candle = Schema.Schema.Type<typeof CandleSchema>;

export const StockHistoryResponseSchema = Schema.Struct({
  symbol: Schema.String,
  market: MarketSchema,
  range: HistoryRangeSchema,
  candles: Schema.Array(CandleSchema),
});
export type StockHistoryResponse = Schema.Schema.Type<typeof StockHistoryResponseSchema>;
