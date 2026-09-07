import { Schema } from 'effect';

export const MarketSchema = Schema.Literal('TWSE', 'TPEX', 'ESB');
export type Market = Schema.Schema.Type<typeof MarketSchema>;

export const ReferencePriceTypeSchema = Schema.Literal('previous_close', 'previous_average');
export type ReferencePriceType = Schema.Schema.Type<typeof ReferencePriceTypeSchema>;

// Pure market-data payload. No provenance here — source metadata joins at the
// response level so providers stay focused on normalized quotes.
// Intraday session fields (tradeDate/open/high/low/volume/limits) are
// nullable: pre-market they may not exist yet, and a missing optional field
// must never fail the whole quote decode.
// referencePrice is the comparison basis for change/changePercent, and its
// meaning depends on referencePriceType: TWSE/TPEX use the previous close,
// while ESB (a negotiated quote-driven market with no close) uses the
// previous-day average price. All three are nullable together: a listing-day
// quote with no valid reference must show —, never a 0-based move.
export const StockQuoteSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  market: MarketSchema,
  price: Schema.NullOr(Schema.Number),
  referencePrice: Schema.NullOr(Schema.Number),
  referencePriceType: ReferencePriceTypeSchema,
  change: Schema.NullOr(Schema.Number),
  changePercent: Schema.NullOr(Schema.Number),
  tradeDate: Schema.NullOr(Schema.String),
  openPrice: Schema.NullOr(Schema.Number),
  highPrice: Schema.NullOr(Schema.Number),
  lowPrice: Schema.NullOr(Schema.Number),
  tradeVolume: Schema.NullOr(Schema.Number),
  // TWSE/TPEX session volume is natively lots (張), verified live (2330,
  // 2026-09-04: Fugle total 13169 = MIS v 13169, daily 14102018 shares).
  // ESB volume is natively shares (股): TPEx quotes TransactionVolume in
  // shares, matching the ESB daily 成交股數 (7883, 2026-09-07: 66789 both).
  tradeVolumeUnit: Schema.Literal('lot', 'share'),
  limitUpPrice: Schema.NullOr(Schema.Number),
  limitDownPrice: Schema.NullOr(Schema.Number),
});
export type StockQuote = Schema.Schema.Type<typeof StockQuoteSchema>;

export const StockQuoteProviderSchema = Schema.Literal('fugle', 'twse-mis', 'twse-openapi', 'tpex-openapi', 'tpex-esb');
export type StockQuoteProvider = Schema.Schema.Type<typeof StockQuoteProviderSchema>;

export const StockQuoteSourceSchema = Schema.Struct({
  provider: StockQuoteProviderSchema,
  fallbackUsed: Schema.Boolean,
  fallbackReason: Schema.NullOr(
    Schema.Literal('config_missing', 'upstream_unavailable'),
  ),
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

// Batch watchlist snapshots keep one client request bounded while preserving
// per-symbol failure state. A failed symbol must not hide successful siblings.
export const StockQuoteBatchErrorSchema = Schema.Literal('not_found', 'unavailable', 'failed');
export type StockQuoteBatchError = Schema.Schema.Type<typeof StockQuoteBatchErrorSchema>;

export const StockQuoteBatchItemSchema = Schema.Struct({
  symbol: Schema.String,
  quote: Schema.NullOr(StockQuoteResponseSchema),
  error: Schema.NullOr(StockQuoteBatchErrorSchema),
});
export type StockQuoteBatchItem = Schema.Schema.Type<typeof StockQuoteBatchItemSchema>;

export const StockQuoteBatchResponseSchema = Schema.Struct({
  items: Schema.Array(StockQuoteBatchItemSchema),
});
export type StockQuoteBatchResponse = Schema.Schema.Type<typeof StockQuoteBatchResponseSchema>;
