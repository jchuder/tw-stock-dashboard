import { useState } from 'react';
import type { DragEvent, JSX, KeyboardEvent } from 'react';
import type { Market, StockQuoteBatchItem } from '@tw-stock-dashboard/contracts';

export interface WatchlistDisplayItem {
  symbol: string;
  name: string;
  market: Market | null;
}

export interface StockWatchlistPanelProps {
  items: readonly WatchlistDisplayItem[];
  quotes: Readonly<Record<string, StockQuoteBatchItem>>;
  isLoading: boolean;
  isRefreshing: boolean;
  isError: boolean;
  onRetry: () => void;
  activeSymbol?: string | null;
  onSelectStock: (symbol: string) => void;
  onRemoveStock: (symbol: string) => void;
  onMoveStock: (symbol: string, targetIndex: number) => void;
}

const MARKET_LABELS: Record<Market, string> = {
  TWSE: '上市',
  TPEX: '上櫃',
  ESB: '興櫃',
};

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
  onMoveStock,
}: StockWatchlistPanelProps): JSX.Element {
  const [draggedSymbol, setDraggedSymbol] = useState<string | null>(null);

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
          {items.map((item, index) => {
            const isActive = activeSymbol === item.symbol;
            const snapshot = quotes[item.symbol];
            const quote = snapshot?.quote ?? null;
            const handleDragStart = (event: DragEvent<HTMLButtonElement>): void => {
              setDraggedSymbol(item.symbol);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', item.symbol);
            };
            const handleDrop = (event: DragEvent<HTMLLIElement>): void => {
              event.preventDefault();
              const symbol = draggedSymbol ?? event.dataTransfer.getData('text/plain');
              if (symbol) {
                onMoveStock(symbol, index);
              }
              setDraggedSymbol(null);
            };
            const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
              let targetIndex: number | null = null;
              if (event.key === 'ArrowUp') {
                targetIndex = index - 1;
              } else if (event.key === 'ArrowDown') {
                targetIndex = index + 1;
              } else if (event.key === 'Home') {
                targetIndex = 0;
              } else if (event.key === 'End') {
                targetIndex = items.length - 1;
              }
              if (targetIndex === null || targetIndex === index) {
                return;
              }
              event.preventDefault();
              onMoveStock(item.symbol, targetIndex);
            };

            return (
              <li
                key={item.symbol}
                className={`watchlist-item${draggedSymbol === item.symbol ? ' is-dragging' : ''}`}
                data-testid={`watchlist-item-${item.symbol}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={handleDrop}
              >
                <button
                  type="button"
                  className="watchlist-drag-handle"
                  draggable
                  onDragStart={handleDragStart}
                  onDragEnd={() => setDraggedSymbol(null)}
                  onKeyDown={handleKeyDown}
                  aria-label={`排序 ${item.symbol}`}
                  title="拖曳排序；方向鍵可移動"
                  data-testid={`watchlist-drag-handle-${item.symbol}`}
                >
                  <span aria-hidden="true">⋮⋮</span>
                </button>
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
                    <small className="watchlist-item-market">
                      {item.market === null ? '市場 —' : MARKET_LABELS[item.market]}
                    </small>
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
                <span className="watchlist-order-actions" aria-label={`移動 ${item.symbol}`}>
                  <button
                    type="button"
                    className="watchlist-order-button"
                    onClick={() => onMoveStock(item.symbol, index - 1)}
                    disabled={index === 0}
                    aria-label={`將 ${item.symbol} 上移`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="watchlist-order-button"
                    onClick={() => onMoveStock(item.symbol, index + 1)}
                    disabled={index === items.length - 1}
                    aria-label={`將 ${item.symbol} 下移`}
                  >
                    ↓
                  </button>
                </span>
                <button
                  type="button"
                  className="btn-remove"
                  onClick={() => onRemoveStock(item.symbol)}
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
