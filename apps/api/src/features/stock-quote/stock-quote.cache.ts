import { Injectable } from '@nestjs/common';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';

export const STOCK_QUOTE_TTL_MS = 5_000;

interface CacheEntry {
  quote: StockQuoteResponse;
  expiresAt: number;
}

// Feature-local TTL store. Deliberately non-generic: one symbol-keyed map
// for normalized quotes, nothing else. `clear` exists so tests can reset the
// module-singleton cache between cases without rebuilding the Nest app.
@Injectable()
export class StockQuoteCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(symbol: string, now: number): StockQuoteResponse | undefined {
    const entry = this.entries.get(symbol);
    if (!entry) {
      return undefined;
    }
    if (now >= entry.expiresAt) {
      this.entries.delete(symbol);
      return undefined;
    }
    return entry.quote;
  }

  set(symbol: string, quote: StockQuoteResponse, now: number): void {
    this.entries.set(symbol, { quote, expiresAt: now + STOCK_QUOTE_TTL_MS });
  }

  clear(): void {
    this.entries.clear();
  }
}
