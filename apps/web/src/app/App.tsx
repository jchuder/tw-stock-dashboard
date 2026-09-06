import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';
import { Toaster } from 'sonner';
import { MarketOverviewPanel } from '../features/market-overview/index.js';
import { GlobalStockSearch } from '../features/stock-quote/index.js';
import { StockAnalysis } from '../widgets/stock-analysis/index.js';
import { fetchHealth } from '../shared/api/health.js';
import './app.css';

export function App(): JSX.Element {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });
  const [search, setSearch] = useState<{ symbol: string; seq: number } | null>(null);

  // Re-submitting the same symbol must still refresh: the seq busts the
  // quote query key so TanStack refetches instead of serving cache.
  const onSearch = (symbol: string): void => {
    setSearch((prev) => ({ symbol, seq: (prev?.seq ?? 0) + 1 }));
  };

  let statusClass = 'checking';
  let statusText = 'API: Checking…';

  if (health.isSuccess) {
    statusClass = 'connected';
    statusText = 'API Connected';
  } else if (health.isError) {
    statusClass = 'disconnected';
    statusText = 'API Disconnected';
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-title-group">
          <h1>Taiwan Stock Dashboard</h1>
          <p className="header-subtitle">台股市場資訊與個股技術分析</p>
        </div>
        <GlobalStockSearch onSearch={onSearch} />
        <div className="api-status-badge" role="status" aria-label="API 連線狀態">
          <span className={`status-dot ${statusClass}`} />
          <span>{statusText}</span>
        </div>
      </header>
      <main>
        <MarketOverviewPanel />
        <StockAnalysis
          requestedSymbol={search?.symbol ?? null}
          searchSeq={search?.seq ?? 0}
          onSymbolSubmitted={onSearch}
        />
      </main>
      <Toaster closeButton />
    </div>
  );
}
