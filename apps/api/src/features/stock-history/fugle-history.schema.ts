import { Schema } from 'effect';
import type { Market } from '@tw-stock-dashboard/contracts';
import type { BaseCandle } from './moving-average.js';

// Feature-local Fugle historical-candles shape
// (https://developer.fugle.tw/docs/data/http-api/historical/candles).
// Decode only what the contract needs; average/turnover/change/sort and the
// rest never enter our code.
export const FugleHistorySchema = Schema.Struct({
  symbol: Schema.String,
  exchange: Schema.Literal('TWSE', 'TPEx'),
  data: Schema.Array(
    Schema.Struct({
      date: Schema.String,
      open: Schema.Number,
      high: Schema.Number,
      low: Schema.Number,
      close: Schema.Number,
      volume: Schema.Number,
    }),
  ),
});
export type FugleHistory = Schema.Schema.Type<typeof FugleHistorySchema>;

// Provider result: normalized candles plus listing market. The visible range,
// MA calculation, and response assembly belong to the service, not the fetch.
export interface FugleHistoryResult {
  symbol: string;
  market: Market;
  candles: BaseCandle[];
}
