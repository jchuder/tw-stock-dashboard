import { Schema } from 'effect';
import type { StockQuoteBatchResponse, StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { StockQuoteBatchResponseSchema, StockQuoteResponseSchema } from '@tw-stock-dashboard/contracts';
import { API_BASE_URL } from '../../../shared/api/base-url.js';

export class StockQuoteRequestError extends Error {
  constructor(readonly status: number) {
    super(`Stock quote request failed: ${status}`);
  }
}

export async function fetchStockQuote(symbol: string): Promise<StockQuoteResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/stocks/${encodeURIComponent(symbol)}/quote`);
  if (!res.ok) {
    throw new StockQuoteRequestError(res.status);
  }
  return Schema.decodeUnknownPromise(StockQuoteResponseSchema)((await res.json()) as unknown);
}

export async function fetchStockQuoteBatch(symbols: readonly string[]): Promise<StockQuoteBatchResponse> {
  const params = new URLSearchParams({ symbols: symbols.join(',') });
  const res = await fetch(`${API_BASE_URL}/api/v1/stocks/quotes?${params.toString()}`);
  if (!res.ok) {
    throw new StockQuoteRequestError(res.status);
  }
  return Schema.decodeUnknownPromise(StockQuoteBatchResponseSchema)((await res.json()) as unknown);
}
