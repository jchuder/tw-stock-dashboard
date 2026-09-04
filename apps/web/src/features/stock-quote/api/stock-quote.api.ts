import { Schema } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteResponseSchema } from '@tw-stock-dashboard/contracts';
import { API_BASE_URL } from '../../../shared/api/base-url.js';

export async function fetchStockQuote(symbol: string): Promise<StockQuoteResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/stocks/${encodeURIComponent(symbol)}/quote`);
  if (!res.ok) {
    throw new Error(`Stock quote request failed: ${res.status}`);
  }
  return Schema.decodeUnknownPromise(StockQuoteResponseSchema)((await res.json()) as unknown);
}
