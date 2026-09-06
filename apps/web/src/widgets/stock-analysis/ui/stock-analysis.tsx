import { useEffect, useState } from 'react';
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

// Stock analysis: left focus column (quote / chart / recent daily table) plus
// a narrow right watchlist rail. DOM order already matches the mobile order
// (focus quote, chart, table, watchlist), so no CSS reordering is needed.
export function StockAnalysis({
  requestedSymbol,
  searchSeq,
  onSymbolSubmitted,
}: {
  requestedSymbol: string | null;
  searchSeq: number;
  onSymbolSubmitted: (symbol: string) => void;
}): JSX.Element {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => loadWatchlist());
  const [validatedStock, setValidatedStock] = useState<{ symbol: string; name: string } | null>(
    null,
  );

  // A new requested symbol invalidates the previous validation until the
  // quote resolves again — this keeps chart/table from showing stale data.
  useEffect(() => {
    if (requestedSymbol !== validatedStock?.symbol) {
      setValidatedStock(null);
    }
  }, [requestedSymbol, validatedStock?.symbol]);

  const onSelectWatchlistStock = (symbol: string): void => {
    if (symbol === requestedSymbol && validatedStock !== null) {
      return;
    }
    onSymbolSubmitted(symbol);
  };

  const onRemoveWatchlistStock = (symbol: string): void => {
    const next = removeFromWatchlist(watchlist, symbol);
    setWatchlist(next);
    saveWatchlist(next);
  };

  const onToggleCurrentWatchlist = (): void => {
    if (!validatedStock) return;
    const next = watchlist.some((item) => item.symbol === validatedStock.symbol)
      ? removeFromWatchlist(watchlist, validatedStock.symbol)
      : addToWatchlist(watchlist, validatedStock);
    setWatchlist(next);
    saveWatchlist(next);
  };

  const isCurrentInWatchlist =
    validatedStock !== null && watchlist.some((item) => item.symbol === validatedStock.symbol);

  return (
    <div className="stock-analysis-layout">
      <div className="focus-column">
        <div className="dashboard-card focus-quote-card">
          <StockQuotePanel
            requestedSymbol={requestedSymbol}
            searchSeq={searchSeq}
            onQuoteResolved={setValidatedStock}
            isInWatchlist={isCurrentInWatchlist}
            onToggleWatchlist={validatedStock !== null ? onToggleCurrentWatchlist : undefined}
          />
        </div>

        {validatedStock === null ? (
          <div className="empty-analysis-state">
            <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.6 }}>
              輸入股票代號或從自選清單選擇股票
              <br />
              即可查看即時報價與近期走勢
            </p>
          </div>
        ) : (
          <StockHistoryPanel symbol={validatedStock.symbol} />
        )}
      </div>

      <aside className="watchlist-rail">
        <StockWatchlistPanel
          items={watchlist}
          activeSymbol={validatedStock?.symbol ?? requestedSymbol}
          onSelectStock={onSelectWatchlistStock}
          onRemoveStock={onRemoveWatchlistStock}
        />
      </aside>
    </div>
  );
}
