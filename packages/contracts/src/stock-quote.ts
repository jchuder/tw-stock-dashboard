import { Schema } from 'effect';

export const MarketSchema = Schema.Literal('TWSE', 'TPEX');
export type Market = Schema.Schema.Type<typeof MarketSchema>;

// Pure market-data payload. No provenance here — source metadata joins at the
// response level so providers stay focused on normalized quotes.
export const StockQuoteSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  market: MarketSchema,
  price: Schema.Number,
  previousClose: Schema.Number,
  change: Schema.Number,
  changePercent: Schema.Number,
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
