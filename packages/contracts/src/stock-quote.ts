import { Schema } from 'effect';

export const MarketSchema = Schema.Literal('TWSE', 'TPEX');
export type Market = Schema.Schema.Type<typeof MarketSchema>;

export const StockQuoteResponseSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  market: MarketSchema,
  price: Schema.Number,
  previousClose: Schema.Number,
  change: Schema.Number,
  changePercent: Schema.Number,
});
export type StockQuoteResponse = Schema.Schema.Type<typeof StockQuoteResponseSchema>;
