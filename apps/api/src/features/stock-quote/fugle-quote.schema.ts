import { Schema } from 'effect';

// Feature-local upstream schema: decode only the Fugle intraday quote fields
// the enriched quote needs
// (https://developer.fugle.tw/docs/data/http-api/intraday/quote).
// Everything else (bids/asks/lastTrade/serial/…) never enters our code.
// lastUpdated stays Unknown on purpose: a malformed freshness marker must
// degrade to asOf null, never fail the whole quote.
// Pre-market the session fields (open/high/low/total/date) may be absent, so
// they are optional-nullable: missing intraday data degrades to null, never
// fails the quote. price/previousClose/change/changePercent stay required.
export const FugleQuoteSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  // Fugle intraday quote only serves TWSE / TPEx listings. Anything else
  // (unknown future value, broken payload) must fail decode -> generic 500,
  // never silently normalize into a market.
  exchange: Schema.Literal('TWSE', 'TPEx'),
  date: Schema.optional(Schema.String),
  lastPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  closePrice: Schema.optional(Schema.NullOr(Schema.Number)),
  previousClose: Schema.optional(Schema.NullOr(Schema.Number)),
  change: Schema.Number,
  changePercent: Schema.Number,
  openPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  highPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  lowPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  total: Schema.optional(
    Schema.Struct({
      tradeVolume: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
  lastUpdated: Schema.optional(Schema.Unknown),
});
export type FugleQuote = Schema.Schema.Type<typeof FugleQuoteSchema>;
