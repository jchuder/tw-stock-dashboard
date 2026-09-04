import type { HealthResponse } from '@tw-stock-dashboard/contracts';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}
