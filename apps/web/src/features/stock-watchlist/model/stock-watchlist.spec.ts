import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addToWatchlist,
  loadWatchlist,
  removeFromWatchlist,
  reorderWatchlist,
  saveWatchlist,
  WATCHLIST_STORAGE_KEY,
} from './stock-watchlist.js';

const DEFAULT_WATCHLIST = ['2330', '7883', '00981A', '0050', '00878', '2317', '00919', '2059'];

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe('stock-watchlist model', () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads valid symbol list from localStorage', () => {
    const data = ['2330', '2454'];
    globalThis.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(data));

    expect(loadWatchlist()).toEqual(data);
  });

  it('seeds the agreed default symbols on first run', () => {
    expect(loadWatchlist()).toEqual(DEFAULT_WATCHLIST);
    expect(globalThis.localStorage.getItem(WATCHLIST_STORAGE_KEY)).toBe(JSON.stringify(DEFAULT_WATCHLIST));
  });

  it('does not migrate the legacy object-shaped storage key', () => {
    globalThis.localStorage.setItem(
      'tw-stock-dashboard.watchlist.v1',
      JSON.stringify([{ symbol: '2330', name: '台積電' }]),
    );

    expect(loadWatchlist()).toEqual(DEFAULT_WATCHLIST);
  });

  it('respects an explicitly cleared empty watchlist without reseeding', () => {
    globalThis.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify([]));

    expect(loadWatchlist()).toEqual([]);
  });

  it('falls back to defaults on corrupted or invalid new-shape data', () => {
    globalThis.localStorage.setItem(WATCHLIST_STORAGE_KEY, 'invalid json {');
    expect(loadWatchlist()).toEqual(DEFAULT_WATCHLIST);

    globalThis.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify([{ symbol: '2330' }]));
    expect(loadWatchlist()).toEqual(DEFAULT_WATCHLIST);
  });

  it('adds a symbol without duplicating existing entries', () => {
    const added = addToWatchlist(['2330'], '2454');
    expect(added).toEqual(['2330', '2454']);
    expect(addToWatchlist(added, '2330')).toEqual(added);
  });

  it('removes a symbol', () => {
    expect(removeFromWatchlist(['2330', '2454'], '2330')).toEqual(['2454']);
  });

  it('reorders a symbol to the requested index', () => {
    expect(reorderWatchlist(['2330', '2454', '2881'], '2881', 0)).toEqual(['2881', '2330', '2454']);
    expect(reorderWatchlist(['2330', '2454', '2881'], '2330', 2)).toEqual(['2454', '2881', '2330']);
  });

  it('saves symbols to localStorage immediately', () => {
    const items = ['2330'];
    saveWatchlist(items);
    expect(globalThis.localStorage.getItem(WATCHLIST_STORAGE_KEY)).toBe(JSON.stringify(items));
  });
});
