import { useState } from 'react';
import type { JSX } from 'react';
import { StockHistoryPanel } from '../../../features/stock-history/index.js';
import { StockQuotePanel } from '../../../features/stock-quote/index.js';
import {
  addToWatchlist,
  loadWatchlist,
  removeFromWatchlist,
  saveWatchlist,
  StockWatchlistPanel,
} from '../../../features/stock-watchlist/index.js';
import type { WatchlistItem } from '../../../features/stock-watchlist/index.js';

export function StockAnalysis(): JSX.Element {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => loadWatchlist());
  const [requestedSymbol, setRequestedSymbol] = useState<string | null>(null);
  const [validatedStock, setValidatedStock] = useState<{ symbol: string; name: string } | null>(
    null,
  );

  const onSymbolSubmitted = (symbol: string): void => {
    setRequestedSymbol(symbol);
    if (symbol !== validatedStock?.symbol) {
      setValidatedStock(null);
    }
  };

  const onSelectWatchlistStock = (symbol: string): void => {
    if (symbol === requestedSymbol && validatedStock !== null) {
      return;
    }
    setRequestedSymbol(symbol);
    if (symbol !== validatedStock?.symbol) {
      setValidatedStock(null);
    }
  };

  const onRemoveWatchlistStock = (symbol: string): void => {
    const next = removeFromWatchlist(watchlist, symbol);
    setWatchlist(next);
    saveWatchlist(next);
  };

  const onAddCurrentToWatchlist = (): void => {
    if (!validatedStock) return;
    const next = addToWatchlist(watchlist, validatedStock);
    setWatchlist(next);
    saveWatchlist(next);
  };

  const isCurrentInWatchlist =
    validatedStock !== null && watchlist.some((item) => item.symbol === validatedStock.symbol);

  return (
    <div className="dashboard-content">
      <aside>
        <StockWatchlistPanel
          items={watchlist}
          activeSymbol={validatedStock?.symbol ?? requestedSymbol}
          onSelectStock={onSelectWatchlistStock}
          onRemoveStock={onRemoveWatchlistStock}
        />
      </aside>

      <div className="analysis-area">
        <div className="dashboard-card">
          <StockQuotePanel
            requestedSymbol={requestedSymbol}
            onSymbolSubmitted={onSymbolSubmitted}
            onQuoteResolved={setValidatedStock}
          />

          {validatedStock !== null && (
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              <button
                type="button"
                onClick={onAddCurrentToWatchlist}
                disabled={isCurrentInWatchlist}
                className="btn-control"
              >
                {isCurrentInWatchlist ? '已在自選' : '加入自選'}
              </button>
            </div>
          )}
        </div>

        {validatedStock === null ? (
          <div className="empty-analysis-state">
            <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.6 }}>
              輸入股票代號或從自選清單選擇股票<br />即可查看即時報價與近期走勢
            </p>
          </div>
        ) : (
          <StockHistoryPanel symbol={validatedStock.symbol} />
        )}
      </div>
    </div>
  );
}
