import type { JSX } from 'react';
import type { StockQuoteBatchItem } from '@tw-stock-dashboard/contracts';
import type { WatchlistItem } from '../model/stock-watchlist.js';

export interface StockWatchlistPanelProps {
  items: readonly WatchlistItem[];
  quotes: Readonly<Record<string, StockQuoteBatchItem>>;
  isLoading: boolean;
  isRefreshing: boolean;
  isError: boolean;
  onRetry: () => void;
  activeSymbol?: string | null;
  onSelectStock: (symbol: string) => void;
  onRemoveStock: (symbol: string) => void;
}

function formatNullable(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function formatChange(change: number | null, changePercent: number | null): string {
  if (change === null || changePercent === null) {
    return '—';
  }
  if (change > 0) {
    return `▲ ${change} (${changePercent >= 0 ? '+' : ''}${changePercent}%)`;
  }
  if (change < 0) {
    return `▼ ${Math.abs(change)} (${changePercent >= 0 ? '+' : ''}${changePercent}%)`;
  }
  return `0 (${changePercent}%)`;
}

function changeClass(change: number | null): string {
  if (change === null || change === 0) {
    return 'price-neutral';
  }
  return change > 0 ? 'price-up' : 'price-down';
}

function formatBatchError(error: StockQuoteBatchItem['error']): string {
  switch (error) {
    case 'not_found':
      return '找不到';
    case 'unavailable':
    case 'failed':
      return '暫時無法更新';
    default:
      return '—';
  }
}

export function StockWatchlistPanel({
  items,
  quotes,
  isLoading,
  isRefreshing,
  isError,
  onRetry,
  activeSymbol,
  onSelectStock,
  onRemoveStock,
}: StockWatchlistPanelProps): JSX.Element {
  return (
    <section aria-label="自選股清單" className="watchlist-card">
      <div className="section-head">
        <div>
          <h3>自選觀察清單</h3>
          {isRefreshing && (
            <span className="watchlist-refreshing" data-testid="watchlist-refreshing" aria-live="polite">
              更新中…
            </span>
          )}
        </div>
        {isError && (
          <button type="button" className="btn-remove" onClick={onRetry} data-testid="watchlist-retry">
            重試
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0 18px 16px' }}>尚無自選股票</p>
      ) : (
        <ul className="watchlist-list" data-testid="watchlist-container">
          {items.map((item) => {
            const isActive = activeSymbol === item.symbol;
            const snapshot = quotes[item.symbol];
            const quote = snapshot?.quote ?? null;
            const handleRemove = (): void => {
              onRemoveStock(item.symbol);
            };

            return (
              <li key={item.symbol} className="watchlist-item" data-testid={`watchlist-item-${item.symbol}`}>
                <button
                  type="button"
                  className="watchlist-item-select"
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={`${item.symbol} ${item.name}`}
                  onClick={() => onSelectStock(item.symbol)}
                >
                  <span className="watchlist-item-identity">
                    <strong>{item.symbol}</strong>
                    <span>{item.name}</span>
                  </span>
                  <span className="watchlist-item-values" data-testid={`watchlist-quote-${item.symbol}`}>
                    {isLoading && snapshot === undefined ? (
                      <span className="watchlist-item-status">載入中…</span>
                    ) : quote !== null ? (
                      <>
                        <span className={`watchlist-price ${changeClass(quote.change)}`}>
                          {formatNullable(quote.price)}
                        </span>
                        <span className={`watchlist-change ${changeClass(quote.change)}`}>
                          {formatChange(quote.change, quote.changePercent)}
                        </span>
                      </>
                    ) : (
                      <span className="watchlist-item-status">
                        {snapshot === undefined && isError ? '暫時無法更新' : formatBatchError(snapshot?.error ?? null)}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-remove"
                  onClick={handleRemove}
                  aria-label={`移除 ${item.symbol}`}
                >
                  移除
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
