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
      <section aria-label="自選股清單" style={{ marginBottom: '16px' }}>
        <h3>自選觀察</h3>
        <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>尚無自選股票</p>
      </section>
    );
  }

  return (
    <section aria-label="自選股清單" style={{ marginBottom: '16px' }}>
      <h3 style={{ margin: '0 0 8px 0' }}>自選觀察</h3>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          maxHeight: '160px',
          overflowY: 'auto',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
        }}
        data-testid="watchlist-container"
      >
        {items.map((item) => {
          const isActive = activeSymbol === item.symbol;
          const handleRemove = (event: MouseEvent): void => {
            event.stopPropagation();
            onRemoveStock(item.symbol);
          };

          return (
            <li
              key={item.symbol}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSelectStock(item.symbol)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                cursor: 'pointer',
                backgroundColor: isActive ? '#f3f4f6' : 'transparent',
                borderBottom: '1px solid #f3f4f6',
              }}
              data-testid={`watchlist-item-${item.symbol}`}
            >
              <span style={{ fontWeight: isActive ? 'bold' : 'normal' }}>
                {item.symbol} {item.name}
              </span>
              <button
                type="button"
                onClick={handleRemove}
                aria-label={`移除 ${item.symbol}`}
                style={{
                  fontSize: '0.8rem',
                  padding: '2px 6px',
                  cursor: 'pointer',
                  color: '#6b7280',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  background: '#ffffff',
                }}
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
