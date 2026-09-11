import { Duration, Effect, Either, Fiber, TestClock, TestContext } from 'effect';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireProjectRedisMutex,
  createTestCacheService,
  flushProjectRedisKeys,
} from './cache-test.helper.js';
import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';
import { QUOTE_POLICY, UNIVERSE_POLICY } from './window-cache.policies.js';
import { WindowCoordinationTimeoutError } from './window-cache.error.js';
import { WindowCacheService, type WindowCachePolicy } from './window-cache.service.js';

const FAST: WindowCachePolicy = {
  windowMs: 60_000,
  snapshotTtlMs: 120_000,
  lockTtlMs: 5_000,
  followerPollMs: 10,
  followerJitterMs: 5,
  followerMaxWaitMs: 500,
};

const decodeNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

let releaseProjectRedis: (() => Promise<void>) | null = null;
let cache: CacheService;
let service: WindowCacheService;
let raw: RedisService;

beforeAll(async () => {
  cache = await createTestCacheService();
  service = new WindowCacheService(cache);
  raw = new RedisService();
  await raw.onModuleInit();
});

afterAll(async () => {
  await raw.onModuleDestroy();
});

beforeEach(async () => {
  releaseProjectRedis = await acquireProjectRedisMutex();
  await flushProjectRedisKeys();
});

afterEach(async () => {
  const release = releaseProjectRedis;
  releaseProjectRedis = null;
  if (release) {
    await release();
  }
});

function run<T, E>(effect: Effect.Effect<T, E>): Promise<Either.Either<T, E>> {
  return Effect.runPromise(Effect.either(effect));
}

describe('WindowCacheService', () => {
  it('loads on miss and serves the same window without reloading', async () => {
    let loads = 0;
    const load = () => {
      loads += 1;
      return Effect.succeed(7);
    };
    const key = 'mdw:v1:test:basic';

    const first = await run(service.getOrLoad({ key, policy: FAST, decode: decodeNumber, load }));
    const second = await run(service.getOrLoad({ key, policy: FAST, decode: decodeNumber, load }));

    expect(loads).toBe(1);
    if (Either.isRight(first) && Either.isRight(second)) {
      expect(first.right.value).toBe(7);
      expect(first.right.cacheHit).toBe(false);
      expect(second.right.value).toBe(7);
      expect(second.right.cacheHit).toBe(true);
      expect(second.right.windowId).toBe(first.right.windowId);
    } else {
      expect(Either.isRight(first) && Either.isRight(second)).toBe(true);
    }
  });

  it('reloads a stale window and overwrites it with the current one', async () => {
    let loads = 0;
    const key = 'mdw:v1:test:stale';
    await cache.setJson(
      key,
      { version: 1, windowId: 1, storedAt: new Date(1000).toISOString(), value: 1 },
      120,
    );

    const result = await run(
      service.getOrLoad({
        key,
        policy: FAST,
        decode: decodeNumber,
        load: () => {
          loads += 1;
          return Effect.succeed(2);
        },
      }),
    );

    expect(loads).toBe(1);
    expect(Either.isRight(result)).toBe(true);
  });

  it('runs one refresh for N concurrent callers on one service', async () => {
    let loads = 0;
    const key = 'mdw:v1:test:fanin';
    const load = () =>
      Effect.gen(function* () {
        loads += 1;
        yield* Effect.sleep(Duration.millis(80));
        return 9;
      });

    const results = await Effect.runPromise(
      Effect.all(
        Array.from({ length: 8 }, () => service.getOrLoad({ key, policy: FAST, decode: decodeNumber, load })),
        { concurrency: 'unbounded' },
      ),
    );

    expect(loads).toBe(1);
    for (const result of results) {
      expect(result.value).toBe(9);
    }
  });

  it('runs one refresh across two independent services on shared Redis', async () => {
    let loads = 0;
    const second = new WindowCacheService(await createTestCacheService());
    const key = 'mdw:v1:test:shared';
    const load = () =>
      Effect.gen(function* () {
        loads += 1;
        yield* Effect.sleep(Duration.millis(80));
        return 5;
      });

    const [a, b] = await Effect.runPromise(
      Effect.all(
        [
          service.getOrLoad({ key, policy: FAST, decode: decodeNumber, load }),
          second.getOrLoad({ key, policy: FAST, decode: decodeNumber, load }),
        ],
        { concurrency: 'unbounded' },
      ),
    );

    expect(loads).toBe(1);
    expect(a.value).toBe(5);
    expect(b.value).toBe(5);
  });

  it('does not cache leader failures and releases the lock', async () => {
    let loads = 0;
    const key = 'mdw:v1:test:leader-fails';
    const flaky = () => {
      loads += 1;
      return loads === 1 ? Effect.fail(new Error('boom')) : Effect.succeed(3);
    };

    const first = await run(service.getOrLoad({ key, policy: FAST, decode: decodeNumber, load: flaky }));
    expect(Either.isLeft(first)).toBe(true);
    const second = await run(service.getOrLoad({ key, policy: FAST, decode: decodeNumber, load: flaky }));

    expect(loads).toBe(2);
    expect(Either.isRight(second)).toBe(true);
  });

  it('lets a follower take over an expired stale lock', async () => {
    let loads = 0;
    const key = 'mdw:v1:test:takeover';
    await raw.set(`${key}:lock`, 'stale-token', 100);
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const result = await run(
      service.getOrLoad({
        key,
        policy: FAST,
        decode: decodeNumber,
        load: () => {
          loads += 1;
          return Effect.succeed(4);
        },
      }),
    );

    expect(loads).toBe(1);
    expect(Either.isRight(result)).toBe(true);
  });

  it('invalidates corrupt envelopes and reloads exactly once', async () => {
    let loads = 0;
    const key = 'mdw:v1:test:corrupt';
    await cache.setJson(key, { garbage: true }, 120);
    const load = () => {
      loads += 1;
      return Effect.succeed(6);
    };

    const first = await run(service.getOrLoad({ key, policy: FAST, decode: decodeNumber, load }));
    const second = await run(service.getOrLoad({ key, policy: FAST, decode: decodeNumber, load }));

    expect(loads).toBe(1);
    expect(Either.isRight(first)).toBe(true);
    expect(Either.isRight(second)).toBe(true);
  });

  it('treats undecodable values as corruption and reloads', async () => {
    let loads = 0;
    const key = 'mdw:v1:test:undecodable';
    const windowId = Math.floor(Date.now() / FAST.windowMs);
    await cache.setJson(key, { version: 1, windowId, storedAt: new Date().toISOString(), value: 'nope' }, 120);

    const result = await run(
      service.getOrLoad({
        key,
        policy: FAST,
        decode: decodeNumber,
        load: () => {
          loads += 1;
          return Effect.succeed(8);
        },
      }),
    );

    expect(loads).toBe(1);
    expect(Either.isRight(result)).toBe(true);
  });

  it('fails typed without calling the loader when Redis is unavailable', async () => {
    let loads = 0;
    const dead = new WindowCacheService(new CacheService(new RedisService()));

    const result = await run(
      dead.getOrLoad({
        key: 'mdw:v1:test:dead',
        policy: FAST,
        decode: decodeNumber,
        load: () => {
          loads += 1;
          return Effect.succeed(1);
        },
      }),
    );

    expect(loads).toBe(0);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('fails closed when a foreign lock never clears', async () => {
    const key = 'mdw:v1:test:stuck';
    await raw.set(`${key}:lock`, 'someone-else', 60_000);

    const result = await run(
      service.getOrLoad({
        key,
        policy: FAST,
        decode: decodeNumber,
        load: () => Effect.succeed(1),
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(WindowCoordinationTimeoutError);
    }
  });

  it('stamps the completion window when a refresh spans a boundary', async () => {
    const windowMs = 1000;
    const policy: WindowCachePolicy = { ...FAST, windowMs };
    const key = 'mdw:v1:test:boundary';
    // Start 100ms before a window boundary; the loader crosses it.
    const startMs = Math.ceil(Date.now() / windowMs) * windowMs - 100;

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(startMs);
        return yield* Effect.either(
          service.getOrLoad({
            key,
            policy,
            decode: decodeNumber,
            load: () =>
              Effect.gen(function* () {
                yield* TestClock.adjust('500 millis');
                return 11;
              }),
          }),
        );
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(Either.isRight(result)).toBe(true);
    const stored = await Effect.runPromise(cache.getJson(key));
    expect(stored).toMatchObject({ version: 1, windowId: Math.floor((startMs + 500) / windowMs) });
  });

  it('does not serve a previous-window snapshot as current', async () => {
    const windowMs = 1000;
    const policy: WindowCachePolicy = { ...FAST, windowMs };
    const key = 'mdw:v1:test:prev-window';
    let loads = 0;

    const first = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(5_000);
        return yield* Effect.either(
          service.getOrLoad({
            key,
            policy,
            decode: decodeNumber,
            load: () => {
              loads += 1;
              return Effect.succeed(1);
            },
          }),
        );
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    const second = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(6_500);
        return yield* Effect.either(
          service.getOrLoad({
            key,
            policy,
            decode: decodeNumber,
            load: () => {
              loads += 1;
              return Effect.succeed(2);
            },
          }),
        );
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(loads).toBe(2);
    expect(Either.isRight(first)).toBe(true);
    expect(Either.isRight(second)).toBe(true);
    if (Either.isRight(second)) {
      expect(second.right.value).toBe(2);
      expect(second.right.cacheHit).toBe(false);
    }
  });

  it('serves new-window snapshot to follower when leader starts pre-boundary and finishes post-boundary', async () => {
    let loads = 0;
    const key = 'mdw:v1:test:follower-boundary-race';
    const windowMs = 200;
    const policy: WindowCachePolicy = {
      windowMs,
      snapshotTtlMs: 2000,
      lockTtlMs: 2000,
      followerPollMs: 15,
      followerJitterMs: 5,
      followerMaxWaitMs: 1500,
    };

    let now = Date.now();
    let msUntilBoundary = windowMs - (now % windowMs);
    while (msUntilBoundary < 60 || msUntilBoundary > 95) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      now = Date.now();
      msUntilBoundary = windowMs - (now % windowMs);
    }

    const preBoundaryWindow = Math.floor(now / windowMs);

    const load = () =>
      Effect.gen(function* () {
        loads += 1;
        yield* Effect.sleep(Duration.millis(120));
        return 42;
      });

    const [leaderResult, followerResult] = await Effect.runPromise(
      Effect.gen(function* () {
        const leaderFiber = yield* Effect.fork(service.getOrLoad({ key, policy, decode: decodeNumber, load }));
        yield* Effect.sleep(Duration.millis(20));
        const followerFiber = yield* Effect.fork(service.getOrLoad({ key, policy, decode: decodeNumber, load }));
        const leader = yield* Effect.either(Fiber.join(leaderFiber));
        const follower = yield* Effect.either(Fiber.join(followerFiber));
        return [leader, follower] as const;
      }),
    );

    expect(loads).toBe(1);
    expect(Either.isRight(leaderResult)).toBe(true);
    expect(Either.isRight(followerResult)).toBe(true);
    if (Either.isRight(leaderResult) && Either.isRight(followerResult)) {
      expect(leaderResult.right.value).toBe(42);
      expect(followerResult.right.value).toBe(42);
      expect(leaderResult.right.windowId).toBe(preBoundaryWindow + 1);
      expect(followerResult.right.windowId).toBe(preBoundaryWindow + 1);
      expect(followerResult.right.cacheHit).toBe(true);
    }
  });

  it('does not elect a second leader when the loader runs long within its lock budget', async () => {
    let loads = 0;
    const key = 'mdw:v1:test:long-loader-lock-budget';
    const policy: WindowCachePolicy = {
      windowMs: 60_000,
      snapshotTtlMs: 120_000,
      lockTtlMs: 500,
      followerPollMs: 20,
      followerJitterMs: 5,
      followerMaxWaitMs: 800,
    };

    const load = () =>
      Effect.gen(function* () {
        loads += 1;
        yield* Effect.sleep(Duration.millis(180));
        return 99;
      });

    const [leaderResult, followerResult] = await Effect.runPromise(
      Effect.gen(function* () {
        const leaderFiber = yield* Effect.fork(service.getOrLoad({ key, policy, decode: decodeNumber, load }));
        yield* Effect.sleep(Duration.millis(30));
        const followerFiber = yield* Effect.fork(service.getOrLoad({ key, policy, decode: decodeNumber, load }));
        const leader = yield* Effect.either(Fiber.join(leaderFiber));
        const follower = yield* Effect.either(Fiber.join(followerFiber));
        return [leader, follower] as const;
      }),
    );

    expect(loads).toBe(1);
    expect(Either.isRight(leaderResult)).toBe(true);
    expect(Either.isRight(followerResult)).toBe(true);
    if (Either.isRight(leaderResult) && Either.isRight(followerResult)) {
      expect(leaderResult.right.value).toBe(99);
      expect(followerResult.right.value).toBe(99);
      expect(followerResult.right.cacheHit).toBe(true);
    }
  });

  it('prevents outer follower arriving after original lock budget from becoming second leader when outer leader is delayed by inner orphan lock', async () => {
    let outerLoaderCalls = 0;
    let innerLoaderCalls = 0;
    const outerKey = 'mdw:v1:test:nested:outer';
    const innerKey = 'mdw:v1:test:nested:inner';

    // Scaled test policies: inner orphan lock holds for 100ms (representing 10s).
    // Outer policy with 250ms lock / 300ms deadline (scaled 20s / 20.5s) holds through
    // the inner delay; with the original 100ms lock, the outer lock would expire and
    // let an outer follower arriving after 100ms take over as a second leader.
    const innerPolicy: WindowCachePolicy = {
      windowMs: 60_000,
      snapshotTtlMs: 120_000,
      lockTtlMs: 100,
      followerPollMs: 10,
      followerJitterMs: 5,
      followerMaxWaitMs: 180,
    };
    const outerPolicy: WindowCachePolicy = {
      windowMs: 60_000,
      snapshotTtlMs: 120_000,
      lockTtlMs: 250,
      followerPollMs: 15,
      followerJitterMs: 5,
      followerMaxWaitMs: 300,
    };

    // Simulate an inner orphan lock held by a dead process with 100ms TTL.
    await raw.set(`${innerKey}:lock`, 'orphan-inner-token', 100);

    const outerLoad = () =>
      Effect.gen(function* () {
        outerLoaderCalls += 1;
        const inner = yield* service.getOrLoad({
          key: innerKey,
          policy: innerPolicy,
          decode: decodeNumber,
          load: () =>
            Effect.gen(function* () {
              innerLoaderCalls += 1;
              // Hold the inner recovery past t=110ms so the outer follower
              // arrives mid-recovery: with the old 100ms outer lock it would
              // take over as a second leader; the 250ms lock must hold it off.
              yield* Effect.sleep(Duration.millis(80));
              return 50;
            }),
        });
        return inner.value + 1;
      });

    // Outer leader starts at t=0 and gets blocked waiting for inner orphan lock.
    // Outer follower arrives at t=110ms (after the original 100ms lock budget).
    const [leaderResult, followerResult] = await Effect.runPromise(
      Effect.gen(function* () {
        const leaderFiber = yield* Effect.fork(
          service.getOrLoad({ key: outerKey, policy: outerPolicy, decode: decodeNumber, load: outerLoad }),
        );
        yield* Effect.sleep(Duration.millis(110));
        const followerFiber = yield* Effect.fork(
          service.getOrLoad({ key: outerKey, policy: outerPolicy, decode: decodeNumber, load: outerLoad }),
        );
        const leader = yield* Effect.either(Fiber.join(leaderFiber));
        const follower = yield* Effect.either(Fiber.join(followerFiber));
        return [leader, follower] as const;
      }),
    );

    expect(outerLoaderCalls).toBe(1);
    expect(innerLoaderCalls).toBe(1);
    expect(Either.isRight(leaderResult)).toBe(true);
    expect(Either.isRight(followerResult)).toBe(true);
    if (Either.isRight(leaderResult) && Either.isRight(followerResult)) {
      expect(leaderResult.right.value).toBe(51);
      expect(followerResult.right.value).toBe(51);
      expect(leaderResult.right.cacheHit).toBe(false);
      expect(followerResult.right.cacheHit).toBe(true);
    }
  });

  it('proves UNIVERSE_POLICY has a 60s lock TTL and matching follower deadline', () => {
    expect(UNIVERSE_POLICY.lockTtlMs).toBe(60_000);
    expect(UNIVERSE_POLICY.followerMaxWaitMs).toBeGreaterThanOrEqual(60_000);
  });

  it('proves QUOTE_POLICY has a 20s lock TTL and 20.5s follower deadline', () => {
    expect(QUOTE_POLICY.windowMs).toBe(30_000);
    expect(QUOTE_POLICY.snapshotTtlMs).toBe(90_000);
    expect(QUOTE_POLICY.lockTtlMs).toBe(20_000);
    expect(QUOTE_POLICY.followerMaxWaitMs).toBe(20_500);
  });
});
