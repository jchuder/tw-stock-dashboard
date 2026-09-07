import { Inject, Injectable, Logger } from '@nestjs/common';
import { Effect, Schema } from 'effect';
import type { Security } from '@tw-stock-dashboard/contracts';
import { SecuritySchema } from '@tw-stock-dashboard/contracts';
import type { UniverseCache } from './universe-cache.port.js';
import { UNIVERSE_CACHE_TOKEN } from './universe-cache.port.js';
import { StockNotFoundError, UniverseUnavailableError } from './universe.error.js';
import { UniverseProvider } from './universe.provider.js';

export const UNIVERSE_CACHE_KEY = 'security-universe:v1';
export const UNIVERSE_LKG_CACHE_KEY = 'security-universe:lkg:v1';
export const UNIVERSE_TTL_SECONDS = 24 * 60 * 60;
export const UNIVERSE_LKG_TTL_SECONDS = 7 * 24 * 60 * 60;

const log = new Logger('UniverseResolver');

interface LoadedUniverse {
  bySymbol: Record<string, Security>;
  // False when at least one required source failed: absence is inconclusive.
  complete: boolean;
  degraded: boolean;
}

function indexBySymbol(securities: ReadonlyArray<Security>): Record<string, Security> {
  return Object.fromEntries(securities.map((s) => [s.symbol, s]));
}

// Process-local in-flight build: concurrent cache misses share one upstream
// rebuild instead of stampeding five official endpoints each.
let inflight: Promise<LoadedUniverse> | null = null;

@Injectable()
export class UniverseResolver {
  constructor(
    @Inject(UNIVERSE_CACHE_TOKEN) private readonly cache: UniverseCache,
    @Inject(UniverseProvider) private readonly provider: UniverseProvider,
  ) {}

  resolve(symbol: string): Effect.Effect<Security, StockNotFoundError | UniverseUnavailableError> {
    return Effect.gen(this, function* () {
      const universe = yield* this.load();
      const found = universe.bySymbol[symbol];
      if (found) {
        return found;
      }
      if (!universe.complete) {
        return yield* new UniverseUnavailableError();
      }
      return yield* new StockNotFoundError();
    });
  }

  // Bulk path for watchlist metadata: unknown symbols are skipped so one
  // delisted symbol never breaks the whole list; only a total outage (no
  // usable entries at all) fails loudly so the UI shows a degraded state
  // instead of a silently empty list.
  resolveMany(symbols: string[]): Effect.Effect<Security[], UniverseUnavailableError> {
    return Effect.gen(this, function* () {
      const universe = yield* this.load();
      if (!universe.complete && Object.keys(universe.bySymbol).length === 0) {
        return yield* new UniverseUnavailableError();
      }
      const out: Security[] = [];
      for (const symbol of symbols) {
        const found = universe.bySymbol[symbol];
        if (found) {
          out.push(found);
        }
      }
      return out;
    });
  }

  private load(): Effect.Effect<LoadedUniverse, UniverseUnavailableError> {
    return Effect.promise(() => {
      inflight ??= this.reload().finally(() => {
        inflight = null;
      });
      return inflight;
    });
  }

  private async reload(): Promise<LoadedUniverse> {
    const cached = await Effect.runPromise(this.cache.getJson(UNIVERSE_CACHE_KEY));
    const decoded =
      cached === null ? null : Schema.decodeUnknownEither(Schema.Array(SecuritySchema))(cached);
    if (decoded !== null && decoded._tag === 'Right') {
      return { bySymbol: indexBySymbol(decoded.right), complete: true, degraded: false };
    }
    if (cached !== null) {
      // Stale schema, not stale data: evict so the next request does not pay
      // another full upstream rebuild for the same poisoned entry.
      log.warn('Cached universe failed schema decode; deleting entry and rebuilding from upstream');
      await Effect.runPromise(this.cache.del(UNIVERSE_CACHE_KEY));
    }
    const build = await Effect.runPromise(this.provider.build());
    if (build.complete) {
      const bySymbol = indexBySymbol(build.securities);
      await Effect.runPromise(this.cache.setJson(UNIVERSE_CACHE_KEY, build.securities, UNIVERSE_TTL_SECONDS));
      // Only a complete build may refresh last-known-good: a partial build
      // must never become the canonical cache for the next 24h of 404s.
      await Effect.runPromise(this.cache.setJson(UNIVERSE_LKG_CACHE_KEY, build.securities, UNIVERSE_LKG_TTL_SECONDS));
      return { bySymbol, complete: true, degraded: false };
    }
    const lkg = await Effect.runPromise(this.cache.getJson(UNIVERSE_LKG_CACHE_KEY));
    const lkgDecoded = lkg === null ? null : Schema.decodeUnknownEither(Schema.Array(SecuritySchema))(lkg);
    if (lkgDecoded !== null && lkgDecoded._tag === 'Right') {
      // Merge with fresh partial winning: LKG must not shadow symbols that a
      // successful source already returned (e.g. a listing that postdates it).
      log.warn(`Universe rebuild partial (${build.failures.join(',')}); serving merged last-known-good`);
      return {
        bySymbol: { ...indexBySymbol(lkgDecoded.right), ...indexBySymbol(build.securities) },
        complete: true,
        degraded: true,
      };
    }
    if (lkg !== null) {
      log.warn('Last-known-good universe failed schema decode; deleting entry');
      await Effect.runPromise(this.cache.del(UNIVERSE_LKG_CACHE_KEY));
    }
    log.warn(`Universe rebuild partial (${build.failures.join(',')}) with no last-known-good`);
    const bySymbol = indexBySymbol(build.securities);
    return { bySymbol, complete: false, degraded: true };
  }
}
