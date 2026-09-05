import { Schema } from 'effect';

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
