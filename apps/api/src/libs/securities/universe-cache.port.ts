import type { Effect } from 'effect';

// Cache port for the Security Universe. Implemented by libs/cache CacheService
// and injected via the 'universe-cache' string token: sibling lib elements
// must not file-import each other (eslint boundaries), so the literal is
// duplicated in libs/cache/cache.module.ts by convention — keep both in sync.
export const UNIVERSE_CACHE_TOKEN = 'universe-cache';

export interface UniverseCache {
  getJson(key: string): Effect.Effect<unknown | null, never>;
  setJson(key: string, value: unknown, ttlSeconds: number): Effect.Effect<void, never>;
}
