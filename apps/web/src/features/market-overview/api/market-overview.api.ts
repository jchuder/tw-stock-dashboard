import type { MarketOverviewResponse } from '@tw-stock-dashboard/contracts';

const API_BASE = '/api/v1';

export async function fetchMarketOverview(): Promise<MarketOverviewResponse> {
  const response = await fetch(`${API_BASE}/market/overview`);
  if (!response.ok) {
    throw new Error(`Failed to fetch market overview: ${response.status}`);
  }
  return (await response.json()) as MarketOverviewResponse;
}
