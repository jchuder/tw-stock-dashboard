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
    if (symbol === requestedSymbol) {
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
    <section>
      <StockWatchlistPanel
        items={watchlist}
        activeSymbol={validatedStock?.symbol ?? requestedSymbol}
        onSelectStock={onSelectWatchlistStock}
        onRemoveStock={onRemoveWatchlistStock}
      />

      <div style={{ marginTop: '16px' }}>
        <StockQuotePanel
          requestedSymbol={requestedSymbol}
          onSymbolSubmitted={onSymbolSubmitted}
          onQuoteResolved={setValidatedStock}
        />

        {validatedStock !== null && (
          <div style={{ margin: '8px 0' }}>
            <button
              type="button"
              onClick={onAddCurrentToWatchlist}
              disabled={isCurrentInWatchlist}
              style={{
                padding: '4px 12px',
                fontSize: '0.9rem',
                borderRadius: '4px',
                border: '1px solid #d1d5db',
                cursor: isCurrentInWatchlist ? 'default' : 'pointer',
                backgroundColor: isCurrentInWatchlist ? '#f3f4f6' : '#ffffff',
                color: isCurrentInWatchlist ? '#9ca3af' : '#111827',
              }}
            >
              {isCurrentInWatchlist ? '已在自選' : '加入自選'}
            </button>
          </div>
        )}

        {validatedStock !== null && <StockHistoryPanel symbol={validatedStock.symbol} />}
      </div>
    </section>
  );
}
