import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addToWatchlist,
  loadWatchlist,
  removeFromWatchlist,
  saveWatchlist,
  WATCHLIST_STORAGE_KEY,
} from './stock-watchlist.js';

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

  it('loads valid watchlist from localStorage', () => {
    const data = [
      { symbol: '2330', name: '台積電' },
      { symbol: '2454', name: '聯發科' },
    ];
    globalThis.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(data));

    const loaded = loadWatchlist();
    expect(loaded).toEqual(data);
  });

  it('safely falls back to empty array on corrupted json or invalid schema', () => {
    globalThis.localStorage.setItem(WATCHLIST_STORAGE_KEY, 'invalid json {');
    expect(loadWatchlist()).toEqual([]);

    globalThis.localStorage.setItem(
      WATCHLIST_STORAGE_KEY,
      JSON.stringify([{ invalidField: 123 }]),
    );
    expect(loadWatchlist()).toEqual([]);
  });

  it('adds item without duplicating existing symbol', () => {
    const initial = [{ symbol: '2330', name: '台積電' }];
    const added = addToWatchlist(initial, { symbol: '2454', name: '聯發科' });
    expect(added).toHaveLength(2);

    const duplicated = addToWatchlist(added, { symbol: '2330', name: '台積電' });
    expect(duplicated).toHaveLength(2);
  });

  it('removes item by symbol', () => {
    const initial = [
      { symbol: '2330', name: '台積電' },
      { symbol: '2454', name: '聯發科' },
    ];
    const removed = removeFromWatchlist(initial, '2330');
    expect(removed).toEqual([{ symbol: '2454', name: '聯發科' }]);
  });

  it('saves items to localStorage immediately', () => {
    const items = [{ symbol: '2330', name: '台積電' }];
    saveWatchlist(items);
    expect(globalThis.localStorage.getItem(WATCHLIST_STORAGE_KEY)).toBe(JSON.stringify(items));
  });
});
