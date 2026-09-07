import { Schema } from 'effect';

// Feature-local Fugle intraday-candles shape
// (https://developer.fugle.tw/docs/data/http-api/intraday/candles).
// Serves the current session only (no from/to); 5m dates are ISO instants
// with a +08:00 offset. average never enters our code.
export const FugleIntradayCandlesSchema = Schema.Struct({
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
export type FugleIntradayCandles = Schema.Schema.Type<typeof FugleIntradayCandlesSchema>;
