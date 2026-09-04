import type { Effect } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';

// Minimal structural port, introduced now that a second provider exists.
// No injection token, registry, factory, or base class — the service injects
// concrete providers directly.
export interface QuoteProvider<E> {
  getQuote(symbol: string): Effect.Effect<StockQuoteResponse, E>;
}
