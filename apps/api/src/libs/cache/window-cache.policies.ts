import type { WindowCachePolicy } from './window-cache.service.js';

// Shared distributed-coordination defaults: every lock guards one refresh
// operation (two 3-second upstream budgets plus fallback margin), followers
// poll briskly and fail closed well inside the lock TTL.
const DEFAULT_LOCK = {
  lockTtlMs: 10_000,
  followerPollMs: 100,
  followerJitterMs: 25,
  followerMaxWaitMs: 10_500,
} as const;

function policy(windowMs: number, snapshotTtlMs: number): WindowCachePolicy {
  return { windowMs, snapshotTtlMs, ...DEFAULT_LOCK };
}

// Intraday snapshots shared per 30-second freshness window.
// QUOTE_POLICY uses an explicit 20s lock budget and 20.5s follower deadline
// to survive inner orphan locks during nested quote resolution.
export const QUOTE_POLICY: WindowCachePolicy = {
  windowMs: 30_000,
  snapshotTtlMs: 90_000,
  lockTtlMs: 20_000,
  followerPollMs: 100,
  followerJitterMs: 25,
  followerMaxWaitMs: 20_500,
};
export const OFFICIAL_QUOTE_POLICY = policy(30_000, 90_000);
export const ESB_SNAPSHOT_POLICY = policy(30_000, 90_000);
export const MIS_INDEX_POLICY = policy(30_000, 90_000);
export const FUGLE_INTRADAY_CANDLES_POLICY = policy(30_000, 90_000);

// Slow-moving end-of-day data.
export const EOD_INDEX_POLICY = policy(60_000, 180_000);
export const INSTITUTIONAL_FLOW_POLICY = policy(5 * 60_000, 15 * 60_000);

// History: the current/today-touching range refreshes on a short window,
// fully closed ranges are effectively immutable.
export const OPEN_HISTORY_POLICY = policy(5 * 60_000, 15 * 60_000);
export const CLOSED_HISTORY_POLICY = policy(24 * 60 * 60_000, 72 * 60 * 60_000);

// Universe canonical refreshes daily; last-known-good is not a window cache.
// Lock TTL covers slow upstream ISIN fetches (up to 45s) plus margin.
export const UNIVERSE_POLICY: WindowCachePolicy = {
  windowMs: 24 * 60 * 60_000,
  snapshotTtlMs: 72 * 60 * 60_000,
  lockTtlMs: 60_000,
  followerPollMs: 100,
  followerJitterMs: 25,
  followerMaxWaitMs: 60_500,
};

export function quoteKey(mode: 'enhanced' | 'public', symbol: string): string {
  return `mdw:v1:quote:${mode}:${symbol}`;
}

export function officialQuoteKey(market: 'TWSE' | 'TPEX'): string {
  return `mdw:v1:official-quote:${market.toLowerCase()}`;
}

export const ESB_SNAPSHOT_KEY = 'mdw:v1:esb-latest';

export const MIS_INDEX_KEY = 'mdw:v1:market:mis-index';

export const TWSE_MI_INDEX_KEY = 'mdw:v1:market:twse-mi-index';

export const TPEX_INDEX_KEY = 'mdw:v1:market:tpex-index';

export const INSTITUTIONAL_FLOW_KEY = 'mdw:v1:market:twse-bfi82u';

export function fugleIntradayCandlesKey(symbol: string, timeframe: string): string {
  return `mdw:v1:history:fugle:intraday:${symbol}:${timeframe}`;
}

export function fugleHistoricalCandlesKey(symbol: string, timeframe: string, from: string, to: string): string {
  return `mdw:v1:history:fugle:${symbol}:${timeframe}:${from}:${to}`;
}

export function monthlyHistoryKey(provider: 'twse' | 'tpex' | 'esb', symbol: string, month: string): string {
  return `mdw:v1:history:${provider}:${symbol}:${month}`;
}

export const UNIVERSE_KEY = 'mdw:v1:universe:canonical';

export const UNIVERSE_LKG_KEY = 'mdw:v1:universe:lkg';

// Last-known-good retention (not a freshness window): degraded builds fall
// back to it, but only complete builds may refresh it.
export const UNIVERSE_LKG_TTL_SECONDS = 7 * 24 * 60 * 60;
