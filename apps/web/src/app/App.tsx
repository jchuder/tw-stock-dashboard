import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { Toaster } from 'sonner';
import { MarketOverviewPanel } from '../features/market-overview/index.js';
import { StockAnalysis } from '../widgets/stock-analysis/index.js';
import { fetchHealth } from '../shared/api/health.js';

export function App(): JSX.Element {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });

  let apiStatus = 'API: Checking…';
  if (health.isSuccess) {
    apiStatus = 'API: Connected';
  } else if (health.isError) {
    apiStatus = 'API: Disconnected';
  }

  return (
    <main>
      <h1>Taiwan Stock Dashboard</h1>
      <p>{apiStatus}</p>
      <MarketOverviewPanel />
      <StockAnalysis />
      <Toaster closeButton />
    </main>
  );
}
