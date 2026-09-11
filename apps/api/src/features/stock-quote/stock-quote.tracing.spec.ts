import { Effect, Either } from 'effect';
import type { Security } from '@tw-stock-dashboard/contracts';
import { StockNotFoundError } from '../../libs/securities/universe.error.js';
import type { UniverseResolver } from '../../libs/securities/universe.resolver.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from '../../libs/cache/cache.service.js';
import { WindowCacheService } from '../../libs/cache/window-cache.service.js';
import type { PinoLogger } from 'nestjs-pino';
import { addSpanEvent, setSpanAttributes } from '../../libs/observability/tracing.js';
import { FugleQuoteProvider } from './fugle-quote.provider.js';
import { OfficialDailyQuoteProvider } from './official-daily-quote.provider.js';
import { StockQuoteCache } from './stock-quote.cache.js';
import { StockQuoteController } from './stock-quote.controller.js';
import { StockQuoteService } from './stock-quote.service.js';
import { TpexEsbQuoteProvider } from './tpex-esb-quote.provider.js';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';

import {
  createTestCacheService,
  flushProjectRedisKeys,
} from '../../libs/cache/cache-test.helper.js';

beforeEach(async () => {
  await flushProjectRedisKeys();
});

vi.mock('../../libs/observability/tracing.js', () => ({
  addSpanEvent: vi.fn(),
  setSpanAttributes: vi.fn(),
}));

function silentLogger(): PinoLogger {
  return { info: () => {}, warn: () => {}, error: () => {} } as unknown as PinoLogger;
}

let testCache: CacheService;

beforeAll(async () => {
  testCache = await createTestCacheService();
});

function service() {
  return new StockQuoteService(
    new FugleQuoteProvider(),
    new TwseMisQuoteProvider(),
    new OfficialDailyQuoteProvider(new WindowCacheService(testCache)),
    new TpexEsbQuoteProvider(new WindowCacheService(testCache)),
    new StockQuoteCache(new WindowCacheService(testCache)),
    fakeUniverse(),
    silentLogger(),
  );
}

const KNOWN_SECURITIES: Record<string, Security> = {
  '2330': { symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' },
};

function fakeUniverse(): UniverseResolver {
  return {
    resolve: (symbol: string) => {
      const found = KNOWN_SECURITIES[symbol];
      return found ? Effect.succeed(found) : Effect.fail(new StockNotFoundError());
    },
    resolveMany: (symbols: string[]) =>
      Effect.succeed(symbols.flatMap((symbol) => KNOWN_SECURITIES[symbol] ?? [])),
  } as unknown as UniverseResolver;
}

const FUGLE_BODY = {
  symbol: '2330',
  name: '台積電',
  exchange: 'TWSE',
  lastPrice: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
};

describe('stock quote trace events', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.mocked(addSpanEvent).mockClear();
    vi.mocked(setSpanAttributes).mockClear();
  });

  it('emits fallback event with reason attrs on Fugle 429', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('api.fugle.tw')
          ? new Response(JSON.stringify({ message: 'rate limited' }), { status: 429 })
          : new Response(
              JSON.stringify({ msgArray: [{ c: '2330', n: '台積電', ex: 'tse', z: '568', y: '566' }] }),
              { status: 200 },
            ),
      ),
    );

    const result = await Effect.runPromise(Effect.either(service().getQuote('2330')));

    expect(Either.isRight(result)).toBe(true);
    expect(addSpanEvent).toHaveBeenCalledWith('market_data.fallback', {
      'stock.symbol': '2330',
      'market_data.from_provider': 'fugle',
      'market_data.to_provider': 'twse-mis',
      'market_data.reason': 'http_429',
      'market_data.reason_type': 'upstream_unavailable',
      'market_data.upstream_status': 429,
    });
  });

  it('sets served attributes on Fugle success without fallback event', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(FUGLE_BODY), { status: 200 })));

    await Effect.runPromise(Effect.either(service().getQuote('2330')));

    expect(setSpanAttributes).toHaveBeenCalledWith({
      'market_data.provider': 'fugle',
      'market_data.fallback_used': false,
      'market_data.cache_hit': false,
    });
    expect(addSpanEvent).not.toHaveBeenCalledWith(
      'market_data.fallback',
      expect.anything(),
    );
  });

  it('emits failed event with safe attrs on final 401', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 })),
    );
    const controller = new StockQuoteController(service(), silentLogger());

    await expect(controller.getQuote('2330')).rejects.toThrow('Failed to fetch stock quote');
    expect(addSpanEvent).toHaveBeenCalledWith('market_data.quote_failed', {
      'market_data.provider': 'fugle',
      'market_data.error_type': 'FugleHttpError',
      'market_data.upstream_status': 401,
    });
  });
});
