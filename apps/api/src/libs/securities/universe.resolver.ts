import { Inject, Injectable, Logger } from '@nestjs/common';
import { Effect, Either, Schema } from 'effect';
import { WindowCacheService } from '../cache/window-cache.service.js';
import {
  UNIVERSE_KEY,
  UNIVERSE_LKG_KEY,
  UNIVERSE_LKG_TTL_SECONDS,
  UNIVERSE_POLICY,
} from '../cache/window-cache.policies.js';
import type { Security } from '@tw-stock-dashboard/contracts';
import { SecuritySchema } from '@tw-stock-dashboard/contracts';
import type { UniverseCache } from './universe-cache.port.js';
import { UNIVERSE_CACHE_TOKEN } from './universe-cache.port.js';
import { StockNotFoundError, UniverseUnavailableError } from './universe.error.js';
import { UniverseProvider, type UniverseBuild } from './universe.provider.js';

// Control-flow signal, not a user-facing error: a partial upstream build must
// resolve through the LKG merge path without being cached as canonical.
class UniverseBuildIncomplete {
  readonly _tag = 'UniverseBuildIncomplete';
  constructor(readonly build: UniverseBuild) {}
}

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

function decodeCompleteUniverse(raw: unknown): Security[] | null {
  if (raw === null) {
    return null;
  }
  const decoded = Schema.decodeUnknownEither(Schema.Array(SecuritySchema))(raw);
  return decoded._tag === 'Right' ? [...decoded.right] : null;
}

// Process-local in-flight build: concurrent cache misses share one upstream
// rebuild instead of stampeding five official endpoints each.
let inflight: Promise<LoadedUniverse> | null = null;

@Injectable()
export class UniverseResolver {
  constructor(
    @Inject(UNIVERSE_CACHE_TOKEN) private readonly cache: UniverseCache,
    @Inject(UniverseProvider) private readonly provider: UniverseProvider,
    @Inject(WindowCacheService) private readonly windows: WindowCacheService,
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
    }).pipe(
      // The Promise boundary can only carry UniverseUnavailableError as a
      // rejection (thrown by reload on unreadable coordination cache).
      // Convert exactly that back to a typed failure; genuine defects re-die.
      Effect.catchAllDefect((defect) =>
        defect instanceof UniverseUnavailableError ? Effect.fail(defect) : Effect.die(defect),
      ),
    );
  }

  private async reload(): Promise<LoadedUniverse> {
    // Coordinated complete builds only: degraded results must never be
    // cached as canonical, so partial builds escape through
    // UniverseBuildIncomplete into the LKG merge path below.
    // Either (not runPromise rejection) carries the outcome across the
    // Promise boundary: runPromise rejects defects and failures alike as
    // FiberFailure, which would hide the incomplete-build signal.
    const coordinated = await Effect.runPromise(
      Effect.either(
        this.windows
          .getOrLoad({
            key: UNIVERSE_KEY,
            policy: UNIVERSE_POLICY,
            decode: decodeCompleteUniverse,
            load: () =>
              Effect.gen(this, function* () {
                const build: UniverseBuild = yield* this.provider.build();
                if (!build.complete) {
                  return yield* Effect.fail(new UniverseBuildIncomplete(build));
                }
                const lkgWritten = yield* Effect.either(
                  this.cache.setJson(UNIVERSE_LKG_KEY, build.securities, UNIVERSE_LKG_TTL_SECONDS),
                );
                if (Either.isLeft(lkgWritten)) {
                  // Write-through best effort: the fresh build is served
                  // regardless; the fetch is already spent.
                  log.warn('Universe LKG write failed; serving fresh build');
                }
                return build.securities;
              }),
          })
          .pipe(
            Effect.mapError((cause) =>
              cause instanceof UniverseBuildIncomplete ? cause : new UniverseUnavailableError(),
            ),
          ),
      ),
    );
    if (Either.isLeft(coordinated)) {
      if (coordinated.left instanceof UniverseBuildIncomplete) {
        return this.degradedFallback(coordinated.left.build);
      }
      throw coordinated.left;
    }
    return { bySymbol: indexBySymbol(coordinated.right.value), complete: true, degraded: false };
  }

  private async degradedFallback(build: UniverseBuild): Promise<LoadedUniverse> {
    let lkg: unknown | null;
    try {
      lkg = await Effect.runPromise(this.cache.getJson(UNIVERSE_LKG_KEY));
    } catch {
      // Fail closed (ADR 008): without a readable fallback there is nothing
      // conclusive to serve.
      throw new UniverseUnavailableError();
    }
    const lkgDecoded = lkg === null ? null : Schema.decodeUnknownEither(Schema.Array(SecuritySchema))(lkg);
    if (lkgDecoded !== null && lkgDecoded._tag === 'Right') {
      // Merge with fresh partial winning, but the union is still unverified:
      // a symbol missing from both is inconclusive, so misses fail 503.
      // Only a canonical-complete cache or an all-sources build earns 404s.
      log.warn(`Universe rebuild partial (${build.failures.join(',')}); serving merged last-known-good`);
      return {
        bySymbol: { ...indexBySymbol(lkgDecoded.right), ...indexBySymbol(build.securities) },
        complete: false,
        degraded: true,
      };
    }
    if (lkg !== null) {
      log.warn('Last-known-good universe failed schema decode; deleting entry');
      try {
        await Effect.runPromise(this.cache.del(UNIVERSE_LKG_KEY));
      } catch {
        log.warn('Universe corrupt-entry eviction failed; rebuilding overwrites it');
      }
    }
    log.warn(`Universe rebuild partial (${build.failures.join(',')}) with no last-known-good`);
    const bySymbol = indexBySymbol(build.securities);
    return { bySymbol, complete: false, degraded: true };
  }

  // A cached canonical universe is always complete: only complete builds are
}
