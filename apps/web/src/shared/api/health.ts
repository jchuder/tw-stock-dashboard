import type { HealthResponse } from '@tw-stock-dashboard/contracts';
import { API_BASE_URL } from './base-url.js';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}
