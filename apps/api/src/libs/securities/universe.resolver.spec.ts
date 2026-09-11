import { Cause, Effect, Either, Exit } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Security } from '@tw-stock-dashboard/contracts';
import type { UniverseCache } from './universe-cache.port.js';
import type { CachePort } from '../../libs/cache/cache.service.js';
import { WindowCacheService } from '../../libs/cache/window-cache.service.js';
import { UNIVERSE_KEY, UNIVERSE_LKG_KEY } from '../../libs/cache/window-cache.policies.js';
import { StockNotFoundError, UniverseUnavailableError } from './universe.error.js';
import type { UniverseBuild } from './universe.provider.js';
import { UniverseProvider } from './universe.provider.js';
import { UniverseResolver } from './universe.resolver.js';

const FULL: Security[] = [
  { symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' },
  { symbol: '7883', name: '饗賓', market: 'ESB', type: 'stock' },
  { symbol: '00981A', name: '主動統一台股增長', market: 'TWSE', type: 'etf' },
];

function fakeCache(
  store: Record<string, unknown> = {},
): UniverseCache & {
  writes: Array<{ key: string; ttl: number }>;
  deletes: string[];
  setNxPx: (key: string, token: string, ttlMs: number) => Effect.Effect<boolean, never>;
  releaseLockIfOwner: (key: string, token: string) => Effect.Effect<number, never>;
} {
  const writes: Array<{ key: string; ttl: number }> = [];
  const deletes: string[] = [];
  return {
    writes,
    deletes,
    getJson: (key: string) => Effect.succeed(Object.hasOwn(store, key) ? (store[key] as unknown) : null),
    setJson: (key: string, value: unknown, ttlSeconds: number) => {
      writes.push({ key, ttl: ttlSeconds });
      store[key] = value;
      return Effect.void;
    },
    del: (key: string) => {
      deletes.push(key);
      delete store[key];
      return Effect.void;
    },
    setNxPx: () => Effect.succeed(true),
    releaseLockIfOwner: () => Effect.succeed(1),
  };
}

function testResolver(
  cache: ReturnType<typeof fakeCache>,
  build: UniverseBuild,
): UniverseResolver {
  return new UniverseResolver(cache, fakeProvider(build), new WindowCacheService(cache as unknown as CachePort));
}

function fakeProvider(build: UniverseBuild): UniverseProvider {
  return { build: () => Effect.succeed(build) } as unknown as UniverseProvider;
}

function resolveOf(resolver: UniverseResolver, symbol: string) {
  return Effect.runPromise(Effect.either(resolver.resolve(symbol)));
}

describe('UniverseResolver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('resolves TWSE stock, ESB stock, and ETF identities', async () => {
    const resolver = testResolver(fakeCache(), { securities: FULL, complete: true, failures: [] });

    expect(await resolveOf(resolver, '2330')).toEqual(
      Either.right({ symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' }),
    );
    expect(await resolveOf(resolver, '7883')).toEqual(
      Either.right({ symbol: '7883', name: '饗賓', market: 'ESB', type: 'stock' }),
    );
    expect(await resolveOf(resolver, '00981A')).toEqual(
      Either.right({ symbol: '00981A', name: '主動統一台股增長', market: 'TWSE', type: 'etf' }),
    );
  });

  it('fails StockNotFoundError for unknown symbols on a complete universe', async () => {
    const resolver = testResolver(fakeCache(), { securities: FULL, complete: true, failures: [] });

    const result = await resolveOf(resolver, '999999');

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(StockNotFoundError);
    }
  });

  it('resolves from successful sources despite a partial build, 503 on total miss', async () => {
    const resolver = testResolver(fakeCache(), { securities: [FULL[0]], complete: false, failures: ['tpex-isin-etf'] });

    expect(await resolveOf(resolver, '2330')).toEqual(Either.right(FULL[0]));

    const missing = await resolveOf(resolver, '006201');
    expect(Either.isLeft(missing)).toBe(true);
    if (Either.isLeft(missing)) {
      expect(missing.left).toBeInstanceOf(UniverseUnavailableError);
    }
  });

  it('serves last-known-good when the rebuild is partial', async () => {
    const cache = fakeCache({ [UNIVERSE_LKG_KEY]: FULL });
    const resolver = testResolver(cache, { securities: [], complete: false, failures: ['x'] });

    expect(await resolveOf(resolver, '7883')).toEqual(Either.right(FULL[1]));
    const missing = await resolveOf(resolver, '999999');
    expect(Either.isLeft(missing)).toBe(true);
    if (Either.isLeft(missing)) {
      expect(missing.left).toBeInstanceOf(UniverseUnavailableError);
    }
  });

  it('prefers fresh partial rows over last-known-good', async () => {
    const NEW1 = { symbol: 'NEW1', name: '新掛牌', market: 'TWSE', type: 'stock' } as const;
    const cache = fakeCache({ [UNIVERSE_LKG_KEY]: [FULL[0]] });
    const resolver = testResolver(cache, { securities: [FULL[0], NEW1], complete: false, failures: ['tpex-isin-etf'] });

    expect(await resolveOf(resolver, 'NEW1')).toEqual(Either.right(NEW1));
    expect(await resolveOf(resolver, '2330')).toEqual(Either.right(FULL[0]));
  });

  it('treats corrupt canonical envelopes as a miss and rebuilds once', async () => {
    const cache = fakeCache({ [UNIVERSE_KEY]: { old: 'shape' } });
    const resolver = testResolver(cache, { securities: FULL, complete: true, failures: [] });

    expect(await resolveOf(resolver, '2330')).toEqual(Either.right(FULL[0]));
    expect(cache.writes.filter((w) => w.key === UNIVERSE_KEY)).toHaveLength(1);
    // The rebuild wrote a valid envelope: the next request hits the window
    // instead of rebuilding forever.
    expect(await resolveOf(resolver, '2330')).toEqual(Either.right(FULL[0]));
    expect(cache.writes.filter((w) => w.key === UNIVERSE_KEY)).toHaveLength(1);
  });

  it('deletes schema-invalid last-known-good entries', async () => {
    const cache = fakeCache({ [UNIVERSE_LKG_KEY]: { old: 'shape' } });
    const resolver = testResolver(cache, { securities: [FULL[0]], complete: false, failures: ['tpex-isin-etf'] });

    expect(await resolveOf(resolver, '2330')).toEqual(Either.right(FULL[0]));
    expect(cache.deletes).toEqual([UNIVERSE_LKG_KEY]);
  });

  it('caches only complete builds as canonical and last-known-good', async () => {
    const cache = fakeCache();
    const resolver = testResolver(cache, { securities: FULL, complete: true, failures: [] });

    await resolveOf(resolver, '2330');

    expect(cache.writes).toContainEqual({ key: UNIVERSE_KEY, ttl: 259_200 });
    expect(cache.writes).toContainEqual({ key: UNIVERSE_LKG_KEY, ttl: 604_800 });
  });

  it('never promotes a partial build to canonical cache', async () => {
    const cache = fakeCache();
    const resolver = testResolver(cache, { securities: [FULL[0]], complete: false, failures: ['tpex-isin-etf'] });

    await resolveOf(resolver, '2330');

    expect(cache.writes).toEqual([]);
  });

  it('resolveMany skips unknown symbols in request order', async () => {
    const resolver = testResolver(fakeCache(), { securities: FULL, complete: true, failures: [] });

    const result = await Effect.runPromise(Effect.either(resolver.resolveMany(['7883', '999999', '2330'])));

    expect(result).toEqual(Either.right([FULL[1], FULL[0]]));
  });

  it('fails closed without touching upstream when the coordination cache is unreadable', async () => {
    let builds = 0;
    const provider = {
      build: () => {
        builds += 1;
        return Effect.succeed({ securities: FULL, complete: true, failures: [] as string[] });
      },
    } as unknown as UniverseProvider;
    const cache = {
      ...fakeCache(),
      getJson: () => Effect.fail(new Error('redis down')),
    };
    const resolver = new UniverseResolver(cache, provider, new WindowCacheService(cache as unknown as CachePort));

    expect(await resolveOf(resolver, '2330')).toEqual(Either.left(new UniverseUnavailableError()));
    expect(builds).toBe(0);
  });

  it('allows genuine defects inside provider to escape instead of becoming UniverseUnavailableError', async () => {
    const provider = {
      build: () => Effect.die(new Error('catastrophic provider defect')),
    } as unknown as UniverseProvider;
    const resolver = new UniverseResolver(fakeCache(), provider, new WindowCacheService(fakeCache() as unknown as CachePort));

    const exit = await Effect.runPromiseExit(resolver.resolve('2330'));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.isDie(exit.cause)).toBe(true);
      expect(Cause.squash(exit.cause)).not.toBeInstanceOf(UniverseUnavailableError);
    }
  });

  it('allows genuine defects inside window layer to escape instead of becoming UniverseUnavailableError', async () => {
    const provider = {
      build: () => Effect.succeed({ securities: FULL, complete: true, failures: [] as string[] }),
    } as unknown as UniverseProvider;
    const cache = {
      ...fakeCache(),
      getJson: () => Effect.die(new Error('catastrophic cache defect')),
    };
    const resolver = new UniverseResolver(cache, provider, new WindowCacheService(cache as unknown as CachePort));

    const exit = await Effect.runPromiseExit(resolver.resolve('2330'));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.isDie(exit.cause)).toBe(true);
      expect(Cause.squash(exit.cause)).not.toBeInstanceOf(UniverseUnavailableError);
    }
  });
});
