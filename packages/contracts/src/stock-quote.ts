import { Schema } from 'effect';

export const MarketSchema = Schema.Literal('TWSE', 'TPEX');
export type Market = Schema.Schema.Type<typeof MarketSchema>;

// Pure market-data payload. No provenance here — source metadata joins at the
// response level so providers stay focused on normalized quotes.
// Intraday session fields (tradeDate/open/high/low/volume/limits) are
// nullable: pre-market they may not exist yet, and a missing optional field
// must never fail the whole quote decode.
export const StockQuoteSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  market: MarketSchema,
  price: Schema.Number,
  previousClose: Schema.Number,
  change: Schema.Number,
  changePercent: Schema.Number,
  tradeDate: Schema.NullOr(Schema.String),
  openPrice: Schema.NullOr(Schema.Number),
  highPrice: Schema.NullOr(Schema.Number),
  lowPrice: Schema.NullOr(Schema.Number),
  tradeVolume: Schema.NullOr(Schema.Number),
  // Both providers natively report the session volume in lots (張),
  // verified live (2330, 2026-09-04: Fugle total 13169 = MIS v 13169,
  // daily 14102018 shares). No conversion, no ambiguity.
  tradeVolumeUnit: Schema.Literal('lot'),
  limitUpPrice: Schema.NullOr(Schema.Number),
  limitDownPrice: Schema.NullOr(Schema.Number),
});
export type StockQuote = Schema.Schema.Type<typeof StockQuoteSchema>;

export const StockQuoteSourceSchema = Schema.Struct({
  provider: Schema.Literal('fugle', 'twse-mis'),
  fallbackUsed: Schema.Boolean,
  fetchedAt: Schema.String,
  asOf: Schema.NullOr(Schema.String),
  cacheHit: Schema.Boolean,
});
export type StockQuoteSource = Schema.Schema.Type<typeof StockQuoteSourceSchema>;

export const StockQuoteResponseSchema = Schema.Struct({
  ...StockQuoteSchema.fields,
  source: StockQuoteSourceSchema,
});
export type StockQuoteResponse = Schema.Schema.Type<typeof StockQuoteResponseSchema>;
