import { Schema } from 'effect';
import type { HistoryRange, StockHistoryResponse } from '@tw-stock-dashboard/contracts';
import { StockHistoryResponseSchema } from '@tw-stock-dashboard/contracts';
import { API_BASE_URL } from '../../../shared/api/base-url.js';

export async function fetchStockHistory(symbol: string, range: HistoryRange): Promise<StockHistoryResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/stocks/${encodeURIComponent(symbol)}/history?range=${range}`);
  if (!res.ok) {
    throw new Error(`Stock history request failed: ${res.status}`);
  }
  return Schema.decodeUnknownPromise(StockHistoryResponseSchema)((await res.json()) as unknown);
}
