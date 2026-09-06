import type { JSX, MouseEvent } from 'react';
import type { WatchlistItem } from '../model/stock-watchlist.js';

export interface StockWatchlistPanelProps {
  items: readonly WatchlistItem[];
  activeSymbol?: string | null;
  onSelectStock: (symbol: string) => void;
  onRemoveStock: (symbol: string) => void;
}

export function StockWatchlistPanel({
  items,
  activeSymbol,
  onSelectStock,
  onRemoveStock,
}: StockWatchlistPanelProps): JSX.Element {
  if (items.length === 0) {
    return (
      <section aria-label="自選股清單" className="watchlist-card">
        <h3>自選觀察</h3>
        <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>尚無自選股票</p>
      </section>
    );
  }

  return (
    <section aria-label="自選股清單" className="watchlist-card">
      <h3>自選觀察</h3>
      <ul className="watchlist-list" data-testid="watchlist-container">
        {items.map((item) => {
          const isActive = activeSymbol === item.symbol;
          const handleRemove = (event: MouseEvent): void => {
            event.stopPropagation();
            onRemoveStock(item.symbol);
          };

          return (
            <li
              key={item.symbol}
              className="watchlist-item"
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSelectStock(item.symbol)}
              data-testid={`watchlist-item-${item.symbol}`}
            >
              <span>
                {item.symbol} {item.name}
              </span>
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
    </section>
  );
}
