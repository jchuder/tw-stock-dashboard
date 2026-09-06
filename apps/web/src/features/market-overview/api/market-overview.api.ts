import type { MarketOverviewResponse } from '@tw-stock-dashboard/contracts';
import { API_BASE_URL } from '../../../shared/api/base-url.js';

export async function fetchMarketOverview(): Promise<MarketOverviewResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/market/overview`);
  if (!response.ok) {
    throw new Error(`Failed to fetch market overview: ${response.status}`);
  }
  return (await response.json()) as MarketOverviewResponse;
}

