import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Effect, Either } from 'effect';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import {
  createTestCacheService,
  flushProjectRedisKeys,
} from '../../libs/cache/cache-test.helper.js';
import type { CacheService } from '../../libs/cache/cache.service.js';
import { WindowCacheService } from '../../libs/cache/window-cache.service.js';
import { RedisCommandError } from '../../libs/cache/redis.error.js';
import { QUOTE_POLICY, quoteKey } from '../../libs/cache/window-cache.policies.js';
import { StockQuoteCache } from './stock-quote.cache.js';

const MOCK_QUOTE: StockQuoteResponse = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 1050,
  referencePrice: 1040,
  referencePriceType: 'previous_close',
  change: 10,
  changePercent: 0.96,
  tradeDate: '2026-09-07',
  openPrice: 1045,
  highPrice: 1055,
  lowPrice: 1040,
  tradeVolume: 12000,
  tradeVolumeUnit: 'lot',
  limitUpPrice: 1140,
  limitDownPrice: 940,
  source: {
    provider: 'fugle',
    fallbackUsed: false,
    fallbackReason: null,
    fetchedAt: '2026-09-07T04:00:00.000Z',
    asOf: '2026-09-07T04:00:00.000Z',
    cacheHit: false,
  },
};

describe('StockQuoteCache', () => {
  let cache: CacheService;
  let windows: WindowCacheService;
  let quoteCache: StockQuoteCache;

  beforeAll(async () => {
    cache = await createTestCacheService();
    windows = new WindowCacheService(cache);
    quoteCache = new StockQuoteCache(windows);
  });

  beforeEach(async () => {
    await flushProjectRedisKeys();
  });

  it('loads on miss and writes to Redis under quoteKey for enhanced mode', async () => {
    let loaderCalls = 0;
    const loader = () => {
      loaderCalls += 1;
      return Effect.succeed(MOCK_QUOTE);
    };

    const result = await Effect.runPromise(
      Effect.either(quoteCache.getOrLoad({ symbol: '2330', mode: 'enhanced', load: loader })),
    );

    expect(loaderCalls).toBe(1);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.symbol).toBe('2330');
      expect(result.right.source.cacheHit).toBe(false);
    }

    const cachedRaw = await Effect.runPromise(cache.getJson(quoteKey('enhanced', '2330')));
    expect(cachedRaw).toMatchObject({
      version: 1,
      value: expect.objectContaining({ symbol: '2330' }),
    });
  });

  it('isolates cache entries between enhanced and public modes', async () => {
    let enhancedCalls = 0;
    let publicCalls = 0;

    const publicQuote: StockQuoteResponse = {
      ...MOCK_QUOTE,
      source: {
        ...MOCK_QUOTE.source,
        provider: 'twse-openapi',
        fallbackUsed: true,
        fallbackReason: 'config_missing',
      },
    };

    const r1 = await Effect.runPromise(
      Effect.either(
        quoteCache.getOrLoad({
          symbol: '2330',
          mode: 'enhanced',
          load: () => {
            enhancedCalls += 1;
            return Effect.succeed(MOCK_QUOTE);
          },
        }),
      ),
    );

    const r2 = await Effect.runPromise(
      Effect.either(
        quoteCache.getOrLoad({
          symbol: '2330',
          mode: 'public',
          load: () => {
            publicCalls += 1;
            return Effect.succeed(publicQuote);
          },
        }),
      ),
    );

    expect(enhancedCalls).toBe(1);
    expect(publicCalls).toBe(1);
    if (Either.isRight(r1) && Either.isRight(r2)) {
      expect(r1.right.source.provider).toBe('fugle');
      expect(r2.right.source.provider).toBe('twse-openapi');
    }
  });

  it('serves the second request from cache within window with cacheHit=true', async () => {
    let loaderCalls = 0;
    const loader = () => {
      loaderCalls += 1;
      return Effect.succeed(MOCK_QUOTE);
    };

    const first = await Effect.runPromise(
      Effect.either(quoteCache.getOrLoad({ symbol: '2330', mode: 'enhanced', load: loader })),
    );
    const second = await Effect.runPromise(
      Effect.either(quoteCache.getOrLoad({ symbol: '2330', mode: 'enhanced', load: loader })),
    );

    expect(loaderCalls).toBe(1);
    if (Either.isRight(first) && Either.isRight(second)) {
      expect(first.right.source.cacheHit).toBe(false);
      expect(second.right.source.cacheHit).toBe(true);
      expect(second.right.source.fetchedAt).toBe(first.right.source.fetchedAt);
    }
  });

  it('propagates Redis failures without executing loader (fail closed)', async () => {
    const failingCache = {
      getJson: () => Effect.fail(new RedisCommandError('GET', 'connection refused')),
      setJson: () => Effect.succeed(undefined),
      del: () => Effect.succeed(undefined),
      setNxPx: () => Effect.succeed(true),
      releaseLockIfOwner: () => Effect.succeed(1),
    } as unknown as CacheService;

    const failingQuoteCache = new StockQuoteCache(new WindowCacheService(failingCache));
    let loaderCalled = false;

    const result = await Effect.runPromise(
      Effect.either(
        failingQuoteCache.getOrLoad({
          symbol: '2330',
          mode: 'enhanced',
          load: () => {
            loaderCalled = true;
            return Effect.succeed(MOCK_QUOTE);
          },
        }),
      ),
    );

    expect(loaderCalled).toBe(false);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(RedisCommandError);
    }
  });

  it('binds QUOTE_POLICY with a 20s lock TTL and 20.5s follower deadline', () => {
    expect(QUOTE_POLICY.lockTtlMs).toBe(20_000);
    expect(QUOTE_POLICY.followerMaxWaitMs).toBe(20_500);
    expect(QUOTE_POLICY.windowMs).toBe(30_000);
    expect(QUOTE_POLICY.snapshotTtlMs).toBe(90_000);
  });
});
