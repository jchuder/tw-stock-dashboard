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

const MAX_BATCH_SYMBOLS = 20;

export async function fetchStockQuoteBatches(symbols: readonly string[]): Promise<StockQuoteBatchResponse> {
  const chunks: string[][] = [];
  for (let index = 0; index < symbols.length; index += MAX_BATCH_SYMBOLS) {
    chunks.push([...symbols.slice(index, index + MAX_BATCH_SYMBOLS)]);
  }

  const responses = await Promise.all(
    chunks.map(async (chunk): Promise<StockQuoteBatchResponse> => {
      try {
        return await fetchStockQuoteBatch(chunk);
      } catch {
        return {
          items: chunk.map((symbol) => ({ symbol, quote: null, error: 'failed' as const })),
        };
      }
    }),
  );

  return { items: responses.flatMap((response) => response.items) };
}
