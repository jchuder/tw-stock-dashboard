import { Either, Schema } from 'effect';

export const WATCHLIST_STORAGE_KEY = 'tw-stock-dashboard.watchlist.v2';

export const WatchlistSchema = Schema.Array(Schema.String);
export type Watchlist = string[];

const DEFAULT_WATCHLIST: readonly string[] = [
  '7883',
  '2330',
  '00981A',
  '0050',
  '00878',
  '2317',
  '00919',
  '2059',
];

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

function defaultWatchlist(): Watchlist {
  return [...DEFAULT_WATCHLIST];
}

export function loadWatchlist(): Watchlist {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(WATCHLIST_STORAGE_KEY);
    if (raw === null) {
      const defaults = defaultWatchlist();
      saveWatchlist(defaults);
      return defaults;
    }
    const decoded = Schema.decodeUnknownEither(WatchlistSchema)(JSON.parse(raw) as unknown);
    if (Either.isRight(decoded)) {
      return [...decoded.right];
    }
    const defaults = defaultWatchlist();
    saveWatchlist(defaults);
    return defaults;
  } catch {
    const defaults = defaultWatchlist();
    saveWatchlist(defaults);
    return defaults;
  }
}

export function saveWatchlist(items: readonly string[]): void {
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

export function addToWatchlist(current: readonly string[], symbol: string): string[] {
  if (current.includes(symbol)) {
    return [...current];
  }
  return [...current, symbol];
}

export function removeFromWatchlist(current: readonly string[], symbol: string): string[] {
  return current.filter((item) => item !== symbol);
}

export function reorderWatchlist(
  current: readonly string[],
  symbol: string,
  targetIndex: number,
): string[] {
  const currentIndex = current.indexOf(symbol);
  if (currentIndex < 0 || current.length < 2) {
    return [...current];
  }
  const next = [...current];
  next.splice(currentIndex, 1);
  const boundedIndex = Math.max(0, Math.min(targetIndex, next.length));
  next.splice(boundedIndex, 0, symbol);
  return next;
}
