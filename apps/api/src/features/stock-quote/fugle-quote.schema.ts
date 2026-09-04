import { Schema } from 'effect';

// Feature-local upstream schema: decode only the Fugle intraday quote fields
// Q1 needs (https://developer.fugle.tw/docs/data/http-api/intraday/quote).
// Everything else (bids/asks/lastTrade/serial/…) never enters our code.
// lastUpdated stays Unknown on purpose: a malformed freshness marker must
// degrade to asOf null, never fail the whole quote.
export const FugleQuoteSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  // Fugle intraday quote only serves TWSE / TPEx listings. Anything else
  // (unknown future value, broken payload) must fail decode -> generic 500,
  // never silently normalize into a market.
  exchange: Schema.Literal('TWSE', 'TPEx'),
  lastPrice: Schema.Number,
  previousClose: Schema.Number,
  change: Schema.Number,
  changePercent: Schema.Number,
  lastUpdated: Schema.optional(Schema.Unknown),
});
export type FugleQuote = Schema.Schema.Type<typeof FugleQuoteSchema>;
