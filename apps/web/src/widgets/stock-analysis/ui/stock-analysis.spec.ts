import type { Security, StockQuoteBatchItem } from '@tw-stock-dashboard/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildWatchlistItems,
  hasRetryableWatchlistQuotes,
  indexWatchlistQuotes,
  indexWatchlistSecurities,
} from './stock-analysis.js';

describe('watchlist helpers', () => {
  it('indexes each watchlist batch result without dropping per-symbol errors', () => {
    const items = [
      { symbol: '2330', quote: null, error: 'unavailable' },
      { symbol: '7883', quote: null, error: 'not_found' },
    ] satisfies readonly StockQuoteBatchItem[];

    const indexed = indexWatchlistQuotes(items);

    expect(Object.keys(indexed)).toEqual(['2330', '7883']);
    expect(indexed['2330']).toEqual(items[0]);
    expect(indexed['7883']).toEqual(items[1]);
  });

  it('indexes security metadata for watchlist display', () => {
    const items = [
      { symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' },
      { symbol: '7883', name: '鑫科', market: 'TPEX', type: 'stock' },
    ] satisfies readonly Security[];

    const indexed = indexWatchlistSecurities(items);

    expect(indexed['2330']).toEqual(items[0]);
    expect(indexed['7883']).toEqual(items[1]);
  });

  it('uses em dashes when saved symbols have no metadata', () => {
    expect(buildWatchlistItems(['999999'], {})).toEqual([
      { symbol: '999999', name: '—', market: null },
    ]);
  });

  it('exposes retry for failed batches but not permanent not-found symbols', () => {
    expect(
      hasRetryableWatchlistQuotes([
        { symbol: '2330', quote: null, error: 'failed' },
        { symbol: '7883', quote: null, error: 'not_found' },
      ]),
    ).toBe(true);
    expect(hasRetryableWatchlistQuotes([{ symbol: '7883', quote: null, error: 'not_found' }])).toBe(false);
  });
});
