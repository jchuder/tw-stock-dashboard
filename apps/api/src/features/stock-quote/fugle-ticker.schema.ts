import { Schema } from 'effect';

// Feature-local upstream schema: decode only the Fugle intraday ticker fields
// the enriched quote needs
// (https://developer.fugle.tw/docs/data/http-api/intraday/ticker).
// limitUpPrice/limitDownPrice are the ground truth for limit prices — never
// derive them from previousClose. Emerging-market listings may omit them, so
// they stay optional-nullable: a missing limit never fails the quote.
export const FugleTickerSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  exchange: Schema.Literal('TWSE', 'TPEx'),
  date: Schema.optional(Schema.String),
  previousClose: Schema.optional(Schema.NullOr(Schema.Number)),
  referencePrice: Schema.optional(Schema.NullOr(Schema.Number)),
  limitUpPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  limitDownPrice: Schema.optional(Schema.NullOr(Schema.Number)),
});
export type FugleTicker = Schema.Schema.Type<typeof FugleTickerSchema>;
