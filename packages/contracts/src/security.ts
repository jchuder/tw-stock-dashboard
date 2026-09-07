import { Schema } from 'effect';
import { MarketSchema } from './stock-quote.js';

// Canonical security identity, resolved from the backend Security Universe
// (merged official sources) — never inferred from whether a quote/history
// provider happens to return data. Scope: TWSE/TPEX/ESB common stocks plus
// TWSE/TPEX ETFs. Warrants, ETNs, and CBs are intentionally out of scope.
export const SecurityTypeSchema = Schema.Literal('stock', 'etf');
export type SecurityType = Schema.Schema.Type<typeof SecurityTypeSchema>;

export const SecuritySchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
  market: MarketSchema,
  type: SecurityTypeSchema,
});
export type Security = Schema.Schema.Type<typeof SecuritySchema>;
