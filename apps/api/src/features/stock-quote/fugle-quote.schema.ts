import { Schema } from 'effect';

// Feature-local upstream schema: decode only the Fugle intraday quote fields
// Q1 needs (https://developer.fugle.tw/docs/data/http-api/intraday/quote).
// Everything else (bids/asks/lastTrade/serial/…) never enters our code.
export const FugleQuoteSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  exchange: Schema.String,
  lastPrice: Schema.Number,
  previousClose: Schema.Number,
  change: Schema.Number,
  changePercent: Schema.Number,
});
export type FugleQuote = Schema.Schema.Type<typeof FugleQuoteSchema>;
