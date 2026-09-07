import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StockWatchlistPanel } from './stock-watchlist-panel.js';

describe('StockWatchlistPanel controls', () => {
  it('keeps keyboard selection and removal as separate native buttons', () => {
    const markup = renderToStaticMarkup(
      <StockWatchlistPanel
        items={[{ symbol: '2330', name: '台積電' }]}
        quotes={{}}
        isLoading={false}
        isRefreshing={false}
        isError={false}
        onRetry={() => undefined}
        activeSymbol="2330"
        onSelectStock={() => undefined}
        onRemoveStock={() => undefined}
      />,
    );

    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).toContain('class="watchlist-item-select"');
    expect(markup).toContain('aria-label="2330 台積電"');
    expect(markup).toContain('aria-label="移除 2330"');
    expect(markup).not.toContain('role="button"');
  });
});
