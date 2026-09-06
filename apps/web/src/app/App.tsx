import { useState } from 'react';
import type { JSX } from 'react';
import { Toaster } from 'sonner';
import { MarketOverviewPanel } from '../features/market-overview/index.js';
import { GlobalStockSearch } from '../features/stock-quote/index.js';
import { loadWatchlist } from '../features/stock-watchlist/index.js';
import { StockAnalysis } from '../widgets/stock-analysis/index.js';
import { formatTaipeiDateTime } from '../shared/datetime/format-taipei.js';
import './app.css';

export interface QuoteProvenance {
  provider: 'fugle' | 'twse-mis';
  asOf: string | null;
}

const PROVIDER_LABELS = {
  fugle: 'Fugle API Connected',
  'twse-mis': 'TWSE MIS',
} as const;

export function App(): JSX.Element {
  // Boot focus: the first watchlist item (seeded with 2330 on first run) is
  // queried immediately so the dashboard never opens on an empty analysis.
  // The search box stays empty — it is an input control, not a selection
  // mirror, so the two are deliberately not synced.
  const [search, setSearch] = useState<{ symbol: string; seq: number } | null>(() => {
    const first = loadWatchlist()[0];
    return first === undefined ? null : { symbol: first.symbol, seq: 0 };
  });
  const [provenance, setProvenance] = useState<QuoteProvenance | null>(null);

  // Re-submitting the same symbol must still refresh: the seq busts the
  // quote query key so TanStack refetches instead of serving cache.
  // We clear provenance immediately so stale metadata is never shown for an
  // in-flight or failed refresh.
  const onSearch = (symbol: string): void => {
    setProvenance(null);
    setSearch((prev) => ({ symbol, seq: (prev?.seq ?? 0) + 1 }));
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-title-group">
          <h1>Taiwan Stock Dashboard</h1>
        </div>
        <GlobalStockSearch onSearch={onSearch} />
        <div className="top-actions">
          <div className="top-meta">
            <div>
              <strong>資料來源：</strong>
              {provenance === null ? '—' : PROVIDER_LABELS[provenance.provider]}
            </div>
            <div>
              最後更新：
              {provenance?.asOf == null ? '—' : formatTaipeiDateTime(provenance.asOf)}
            </div>
          </div>
        </div>
      </header>
      <main className="dashboard-main">
        <div className="page-heading">
          <h1>台股市場焦點</h1>
        </div>
        <MarketOverviewPanel />
        <StockAnalysis
          requestedSymbol={search?.symbol ?? null}
          searchSeq={search?.seq ?? 0}
          onSymbolSubmitted={onSearch}
          onProvenance={setProvenance}
        />
      </main>
      <Toaster closeButton />
    </div>
  );
}
