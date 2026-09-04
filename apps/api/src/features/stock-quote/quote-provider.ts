import type { Effect } from 'effect';
import type { StockQuote } from '@tw-stock-dashboard/contracts';

// Provider result: normalized quote plus the upstream freshness marker.
// Provenance (which provider, fallback, fetch time, cache) is orchestration
// context owned by the service — providers must not fill it themselves.
export interface QuoteProviderResult {
  quote: StockQuote;
  asOf: string | null;
}

// Minimal structural port, introduced now that a second provider exists.
// No injection token, registry, factory, or base class — the service injects
// concrete providers directly.
export interface QuoteProvider<E> {
  getQuote(symbol: string): Effect.Effect<QuoteProviderResult, E>;
}
