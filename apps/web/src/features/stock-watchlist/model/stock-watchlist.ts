import { Either, Schema } from 'effect';

export const WATCHLIST_STORAGE_KEY = 'tw-stock-dashboard.watchlist.v1';

export const WatchlistItemSchema = Schema.Struct({
  symbol: Schema.String,
  name: Schema.String,
});
export type WatchlistItem = Schema.Schema.Type<typeof WatchlistItemSchema>;

export const WatchlistSchema = Schema.Array(WatchlistItemSchema);

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

export function loadWatchlist(): WatchlistItem[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const json = JSON.parse(raw) as unknown;
    const decoded = Schema.decodeUnknownEither(WatchlistSchema)(json);
    if (Either.isRight(decoded)) {
      return [...decoded.right];
    }
    return [];
  } catch {
    return [];
  }
}

export function saveWatchlist(items: readonly WatchlistItem[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota or disabled errors safe fail
  }
}

export function addToWatchlist(
  current: readonly WatchlistItem[],
  item: WatchlistItem,
): WatchlistItem[] {
  if (current.some((existing) => existing.symbol === item.symbol)) {
    return [...current];
  }
  return [...current, item];
}

export function removeFromWatchlist(
  current: readonly WatchlistItem[],
  symbol: string,
): WatchlistItem[] {
  return current.filter((item) => item.symbol !== symbol);
}
