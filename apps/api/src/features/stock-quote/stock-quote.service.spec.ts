import { Effect, Either, Fiber, TestClock, TestContext } from 'effect';
import type { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Security, StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import { CacheService } from '../../libs/cache/cache.service.js';
import type { FugleQuoteError } from './fugle-quote.error.js';
import { FugleQuoteProvider } from './fugle-quote.provider.js';
import type { OfficialDailyQuoteError } from './official-daily-quote.error.js';
import { OfficialDailyQuoteProvider, TPEX_DAILY_QUOTE_URL, TWSE_DAILY_QUOTE_URL } from './official-daily-quote.provider.js';
import { StockNotFoundError } from '../../libs/securities/universe.error.js';
import type { UniverseUnavailableError } from '../../libs/securities/universe.error.js';
import type { UniverseResolver } from '../../libs/securities/universe.resolver.js';
import { StockQuoteCache } from './stock-quote.cache.js';
import { StockQuoteService } from './stock-quote.service.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';
import { TpexEsbQuoteProvider } from './tpex-esb-quote.provider.js';
import type { TpexEsbQuoteError } from './tpex-esb-quote.error.js';

const MIS_BODY = { msgArray: [{ c: '2330', n: '台積電', ex: 'tse', z: '568', y: '566' }] };
const OFFICIAL_TWSE_BODY = [
  {
    Date: '1150904',
    Code: '2330',
    Name: '台積電',
    TradeVolume: '14102018',
    OpeningPrice: '2415.00',
    HighestPrice: '2415.00',
    LowestPrice: '2390.00',
    ClosingPrice: '2410.00',
    Change: '20.0000',
  },
];

const FUGLE_BODY = {
  symbol: '2330',
  name: '台積電',
  exchange: 'TWSE',
  lastPrice: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
};

const EXPECTED_QUOTE = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 568,
  referencePrice: 566,
  referencePriceType: 'previous_close',
  change: 2,
  changePercent: 0.35,
  tradeDate: null,
  openPrice: null,
  highPrice: null,
  lowPrice: null,
  tradeVolume: null,
  tradeVolumeUnit: 'lot',
  limitUpPrice: null,
  limitDownPrice: null,
};
type QuoteResult = Either.Either<
  StockQuoteResponse,
  FugleQuoteError |
    TwseMisQuoteError |
    OfficialDailyQuoteError |
    TpexEsbQuoteError |
    StockNotFoundError |
    UniverseUnavailableError
>;

interface ExpectedSource {
  provider: 'fugle' | 'twse-mis' | 'twse-openapi' | 'tpex-openapi' | 'tpex-esb';
  fallbackUsed: boolean;
  cacheHit: boolean;
  asOf: string | null;
}

// fetchedAt is clock-dependent, so it is checked by shape (ISO UTC) rather
// than by value; every other field is asserted exactly.
function expectRightQuote(result: QuoteResult, quote: Record<string, unknown>, source: ExpectedSource): void {
  expect(Either.isRight(result)).toBe(true);
  if (Either.isRight(result)) {
    expect(result.right).toMatchObject({ ...quote, source });
    expect(result.right.source.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
}

function silentLogger(): PinoLogger {
  return { info: () => {}, warn: () => {}, error: () => {} } as unknown as PinoLogger;
}

function service() {
  return new StockQuoteService(
    new FugleQuoteProvider(),
    new TwseMisQuoteProvider(),
    new OfficialDailyQuoteProvider(new CacheService()),
    new TpexEsbQuoteProvider(new CacheService()),
    new StockQuoteCache(),
    fakeUniverse(),
    silentLogger(),
  );
}

// Universe-first short-circuit: known symbols resolve locally so provider
// stubs only shape quote traffic; unknown symbols never reach upstream.
const KNOWN_SECURITIES: Record<string, Security> = {
  '2330': { symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' },
  '2454': { symbol: '2454', name: '聯發科', market: 'TWSE', type: 'stock' },
  '006201': { symbol: '006201', name: '元大富櫃50', market: 'TPEX', type: 'stock' },
  '7883': { symbol: '7883', name: '饗賓', market: 'ESB', type: 'stock' },
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

function callsTo(fetchMock: Mock, host: string): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(host)).length;
}

describe('StockQuoteService timeout orchestration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('falls back to MIS when Fugle hangs past 3s', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input).includes('api.fugle.tw')) {
          return new Promise<Response>(() => {});
        }
        return new Response(JSON.stringify(MIS_BODY), { status: 200 });
      }),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(Effect.either(service().getQuote('2330')));
        yield* TestClock.adjust('3 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expectRightQuote(result, EXPECTED_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: null,
    });
  });

  it('fails TwseMisTimeoutError when both upstreams hang', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(Effect.either(service().getQuote('2330')));
        yield* TestClock.adjust('3 seconds');
        yield* TestClock.adjust('3 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TwseMisTimeoutError');
    }
  });
});

describe('StockQuoteService TTL cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('serves the second request from cache within TTL with one upstream round', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FUGLE_BODY), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = service();

    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const r1 = yield* Effect.either(svc.getQuote('2330'));
        yield* TestClock.adjust(4000);
        const r2 = yield* Effect.either(svc.getQuote('2330'));
        return [r1, r2] as const;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    const fugleSource = { provider: 'fugle', fallbackUsed: false, cacheHit: false, asOf: null } as const;
    expectRightQuote(first, EXPECTED_QUOTE, fugleSource);
    expectRightQuote(second, EXPECTED_QUOTE, { ...fugleSource, cacheHit: true });
    // One upstream round is two Fugle calls: intraday quote + ticker.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches once TTL expires at exactly 5s', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FUGLE_BODY), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = service();

    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const r1 = yield* Effect.either(svc.getQuote('2330'));
        yield* TestClock.adjust(5000);
        const r2 = yield* Effect.either(svc.getQuote('2330'));
        return [r1, r2] as const;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    const fugleSource = { provider: 'fugle', fallbackUsed: false, cacheHit: false, asOf: null } as const;
    expectRightQuote(first, EXPECTED_QUOTE, fugleSource);
    expectRightQuote(second, EXPECTED_QUOTE, fugleSource);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('isolates cache entries per symbol', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async (input: unknown) => {
      const symbol = String(input).split('/').at(-1) ?? '2330';
      return new Response(JSON.stringify({ ...FUGLE_BODY, symbol }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = service();

    const [first, second, third] = await Effect.runPromise(
      Effect.gen(function* () {
        const r1 = yield* Effect.either(svc.getQuote('2330'));
        yield* TestClock.adjust(1000);
        const r2 = yield* Effect.either(svc.getQuote('2454'));
        yield* TestClock.adjust(1000);
        const r3 = yield* Effect.either(svc.getQuote('2330'));
        return [r1, r2, r3] as const;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    const fugleSource = { provider: 'fugle', fallbackUsed: false, cacheHit: false, asOf: null } as const;
    expectRightQuote(first, EXPECTED_QUOTE, fugleSource);
    expectRightQuote(second, { ...EXPECTED_QUOTE, symbol: '2454' }, fugleSource);
    expectRightQuote(third, EXPECTED_QUOTE, { ...fugleSource, cacheHit: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('does not cache failures: a 401 then retries upstream', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    let quoteCalls = 0;
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('intraday/quote')) {
        quoteCalls += 1;
        if (quoteCalls === 1) {
          return new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 });
        }
      }
      return new Response(JSON.stringify(FUGLE_BODY), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = service();

    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const r1 = yield* Effect.either(svc.getQuote('2330'));
        yield* TestClock.adjust(1000);
        const r2 = yield* Effect.either(svc.getQuote('2330'));
        return [r1, r2] as const;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(Either.isLeft(first)).toBe(true);
    expectRightQuote(second, EXPECTED_QUOTE, {
      provider: 'fugle',
      fallbackUsed: false,
      cacheHit: false,
      asOf: null,
    });
    expect(quoteCalls).toBe(2);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });

  it('caches MIS fallback success without hitting either provider again', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('api.fugle.tw')) {
        return new Response(JSON.stringify({ message: 'rate limited' }), { status: 429 });
      }
      return new Response(JSON.stringify(MIS_BODY), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = service();

    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const r1 = yield* Effect.either(svc.getQuote('2330'));
        yield* TestClock.adjust(1000);
        const r2 = yield* Effect.either(svc.getQuote('2330'));
        return [r1, r2] as const;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    const misSource = { provider: 'twse-mis', fallbackUsed: true, cacheHit: false, asOf: null } as const;
    expectRightQuote(first, EXPECTED_QUOTE, misSource);
    expectRightQuote(second, EXPECTED_QUOTE, { ...misSource, cacheHit: true });
    expect(callsTo(fetchMock, 'api.fugle.tw')).toBe(2);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(1);
  });

  it('starts TTL at cache insertion, not request start', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('api.fugle.tw')) {
        return new Promise<Response>(() => {});
      }
      return new Response(JSON.stringify(MIS_BODY), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = service();

    // t=0 request, +3s Fugle timeout, MIS immediate success (cached at t=3s),
    // +4s second request: total t=7s, but only 4s after insertion -> HIT.
    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const f1 = yield* Effect.fork(Effect.either(svc.getQuote('2330')));
        yield* TestClock.adjust('3 seconds');
        const r1 = yield* Fiber.join(f1);
        yield* TestClock.adjust('4 seconds');
        const r2 = yield* Effect.either(svc.getQuote('2330'));
        return [r1, r2] as const;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    const misSource = { provider: 'twse-mis', fallbackUsed: true, cacheHit: false, asOf: null } as const;
    expectRightQuote(first, EXPECTED_QUOTE, misSource);
    expectRightQuote(second, EXPECTED_QUOTE, { ...misSource, cacheHit: true });
    expect(callsTo(fetchMock, 'api.fugle.tw')).toBe(2);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(1);
  });
});

describe('StockQuoteService ticker fallback policy', () => {

  it('uses official daily data directly when Fugle is not configured', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === TWSE_DAILY_QUOTE_URL) {
        return new Response(JSON.stringify(OFFICIAL_TWSE_BODY), { status: 200 });
      }
      throw new Error(`unexpected upstream call: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(Effect.either(service().getQuote('2330')));

    expectRightQuote(
      result,
      {
        ...EXPECTED_QUOTE,
        price: 2410,
        referencePrice: 2390,
        change: 20,
        changePercent: 0.84,
        tradeDate: '2026-09-04',
        openPrice: 2415,
        highPrice: 2415,
        lowPrice: 2390,
        tradeVolume: 14102.018,
      },
      {
        provider: 'twse-openapi',
        fallbackUsed: true,
        cacheHit: false,
        asOf: null,
      },
    );
    expect(callsTo(fetchMock, TWSE_DAILY_QUOTE_URL)).toBe(1);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(1);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('reports StockNotFound from universe without calling any provider', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(MIS_BODY), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(Effect.either(service().getQuote('999999')));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('StockNotFoundError');
    }
    expect(callsTo(fetchMock, 'api.fugle.tw')).toBe(0);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });

  it('fails with StockNotFoundError on Fugle 404 for a universe-known symbol without calling MIS', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'Resource Not Found' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(Effect.either(service().getQuote('2330')));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('StockNotFoundError');
    }
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });

  it('does not fall back on Fugle 403', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('api.fugle.tw')) {
        return new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 });
      }
      return new Response(JSON.stringify(MIS_BODY), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(Effect.either(service().getQuote('2330')));

    expect(Either.isLeft(result)).toBe(true);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });

  it('surfaces quote 422 over ticker 503 with no MIS fallback', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/intraday/quote/')) {
        return new Response(JSON.stringify({ message: 'unprocessable' }), { status: 422 });
      }
      if (String(input).includes('api.fugle.tw')) {
        return new Response(JSON.stringify({ message: 'downstream' }), { status: 503 });
      }
      return new Response(JSON.stringify(MIS_BODY), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(Effect.either(service().getQuote('2330')));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      if (result.left._tag === 'FugleHttpError') {
        expect(result.left.status).toBe(422);
      }
    }
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });
});
describe('StockQuoteService ESB routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const ESB_ROW = {
    Date: '1150907',
    Time: '160006',
    SecuritiesCompanyCode: '7883',
    CompanyName: '饗賓',
    PreviousAveragePrice: '280',
    Highest: '293',
    Lowest: '281.5',
    Average: '283.72',
    LatestPrice: '290',
    TransactionVolume: '66789',
  };

  const ESB_QUOTE = {
    symbol: '7883',
    name: '饗賓',
    market: 'ESB',
    price: 290,
    referencePrice: 280,
    referencePriceType: 'previous_average',
    change: 10,
    changePercent: 3.57,
    tradeDate: '2026-09-07',
    openPrice: null,
    highPrice: 293,
    lowPrice: 281.5,
    tradeVolume: 66789,
    tradeVolumeUnit: 'share',
    limitUpPrice: null,
    limitDownPrice: null,
  };

  it('routes ESB symbols to the TPEx snapshot without touching Fugle or MIS', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('tpex_esb_latest_statistics')) {
        return new Response(JSON.stringify([ESB_ROW]), { status: 200 });
      }
      throw new Error(`unexpected upstream call: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(Effect.either(service().getQuote('7883')));

    expectRightQuote(
      result,
      ESB_QUOTE,
      { provider: 'tpex-esb', fallbackUsed: false, cacheHit: false, asOf: '2026-09-07T08:00:06.000Z' },
    );
    expect(callsTo(fetchMock, 'api.fugle.tw')).toBe(0);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });

  it('surfaces ESB snapshot failures without Fugle or MIS fallback', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(Effect.either(service().getQuote('7883')));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TpexEsbHttpError');
    }
    expect(callsTo(fetchMock, 'api.fugle.tw')).toBe(0);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });
});


describe('StockQuoteService Public Data closed-session freshness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const OFFICIAL_0907_BODY = [
    {
      Date: '1150907',
      Code: '2330',
      Name: '台積電',
      TradeVolume: '14102018',
      OpeningPrice: '34.32',
      HighestPrice: '34.47',
      LowestPrice: '34.11',
      ClosingPrice: '34.39',
      Change: '0.2800',
    },
  ];

  const OFFICIAL_0908_BODY = [
    {
      Date: '1150908',
      Code: '2330',
      Name: '台積電',
      TradeVolume: '35251328',
      OpeningPrice: '34.35',
      HighestPrice: '34.35',
      LowestPrice: '34.04',
      ClosingPrice: '34.07',
      Change: '-0.32',
    },
  ];

  const MIS_0908_BODY = {
    msgArray: [
      {
        c: '2330',
        n: '台積電',
        ex: 'tse',
        z: '34.0700',
        y: '34.3900',
        d: '20260908',
        t: '13:30:00',
        o: '34.35',
        h: '34.35',
        l: '34.04',
        v: '33414',
      },
    ],
  };

  const MIS_0907_BODY = {
    msgArray: [
      {
        c: '2330',
        n: '台積電',
        ex: 'tse',
        z: '34.39',
        y: '34.11',
        d: '20260907',
        t: '13:30:00',
        o: '34.32',
        h: '34.47',
        l: '34.11',
        v: '47066',
      },
    ],
  };

  const MIS_INTRADAY_0909_BODY = {
    msgArray: [{ c: '2330', n: '台積電', ex: 'tse', z: '568', y: '566', d: '20260909' }],
  };

  const EXPECTED_MIS_0908_QUOTE = {
    symbol: '2330',
    name: '台積電',
    market: 'TWSE',
    price: 34.07,
    referencePrice: 34.39,
    referencePriceType: 'previous_close',
    change: -0.32,
    changePercent: -0.93,
    tradeDate: '2026-09-08',
    openPrice: 34.35,
    highPrice: 34.35,
    lowPrice: 34.04,
    tradeVolume: 33414,
    tradeVolumeUnit: 'lot',
    limitUpPrice: null,
    limitDownPrice: null,
  };

  function publicDataFetch(officialBody: unknown, misBody: unknown): Mock {
    return vi.fn(async (input: unknown) => {
      if (String(input) === TWSE_DAILY_QUOTE_URL || String(input) === TPEX_DAILY_QUOTE_URL) {
        return new Response(JSON.stringify(officialBody), { status: 200 });
      }
      if (String(input).includes('mis.twse.com.tw')) {
        return new Response(JSON.stringify(misBody), { status: 200 });
      }
      throw new Error(`unexpected upstream call: ${String(input)}`);
    });
  }

  function runAt<T, E>(nowMs: number, effect: Effect.Effect<T, E>): Promise<Either.Either<T, E>> {
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMs);
        return yield* Effect.either(effect);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  }

  const OVERNIGHT_0909 = new Date('2026-09-09T01:05:00+08:00').getTime();
  const MORNING_0909 = new Date('2026-09-09T10:00:00+08:00').getTime();

  it('prefers completed MIS close over a stale official snapshot (09-08 34.07 beats 09-07 34.39)', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const fetchMock = publicDataFetch(OFFICIAL_0907_BODY, MIS_0908_BODY);
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAt(OVERNIGHT_0909, service().getQuote('2330'));

    expectRightQuote(result, EXPECTED_MIS_0908_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: null,
    });
    if (Either.isRight(result)) {
      expect(result.right.source.fallbackReason).toBe('config_missing');
    }
    expect(callsTo(fetchMock, TWSE_DAILY_QUOTE_URL)).toBe(1);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(1);
  });

  it('keeps the newer official snapshot when MIS is older', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const fetchMock = publicDataFetch(OFFICIAL_0908_BODY, MIS_0907_BODY);
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAt(OVERNIGHT_0909, service().getQuote('2330'));

    expectRightQuote(
      result,
      {
        ...EXPECTED_MIS_0908_QUOTE,
        price: 34.07,
        referencePrice: 34.39,
        change: -0.32,
        changePercent: -0.93,
        tradeDate: '2026-09-08',
        openPrice: 34.35,
        highPrice: 34.35,
        lowPrice: 34.04,
        tradeVolume: 35251.328,
      },
      {
        provider: 'twse-openapi',
        fallbackUsed: true,
        cacheHit: false,
        asOf: null,
      },
    );
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(1);
  });

  it('ignores today intraday MIS in Public Data mode (09-09 session must not override 09-08 close)', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const fetchMock = publicDataFetch(OFFICIAL_0908_BODY, MIS_INTRADAY_0909_BODY);
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAt(MORNING_0909, service().getQuote('2330'));

    if (Either.isRight(result)) {
      expect(result.right.source.provider).toBe('twse-openapi');
      expect(result.right.tradeDate).toBe('2026-09-08');
    } else {
      expect(Either.isRight(result)).toBe(true);
    }
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(1);
  });

  it('does not serve a stale cached official snapshot over a newer completed MIS close', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('mis.twse.com.tw')) {
        return new Response(JSON.stringify(MIS_0908_BODY), { status: 200 });
      }
      throw new Error(`unexpected upstream call: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const staleCache = {
      getJson: (key: string) =>
        Effect.succeed(key === 'official-quote:twse:v1' ? OFFICIAL_0907_BODY : null),
      setJson: () => Effect.succeed(undefined),
      del: () => Effect.succeed(undefined),
    };
    const svc = new StockQuoteService(
      new FugleQuoteProvider(),
      new TwseMisQuoteProvider(),
      new OfficialDailyQuoteProvider(staleCache as unknown as CacheService),
      new TpexEsbQuoteProvider(new CacheService()),
      new StockQuoteCache(),
      fakeUniverse(),
      silentLogger(),
    );

    const result = await runAt(OVERNIGHT_0909, svc.getQuote('2330'));

    expectRightQuote(result, EXPECTED_MIS_0908_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: null,
    });
    expect(callsTo(fetchMock, 'openapi.twse.com.tw')).toBe(0);
  });

  it('still serves official data when MIS is unavailable', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input) === TWSE_DAILY_QUOTE_URL) {
        return new Response(JSON.stringify(OFFICIAL_0907_BODY), { status: 200 });
      }
      if (String(input).includes('mis.twse.com.tw')) {
        return new Response('boom', { status: 500 });
      }
      throw new Error(`unexpected upstream call: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAt(OVERNIGHT_0909, service().getQuote('2330'));

    if (Either.isRight(result)) {
      expect(result.right.source.provider).toBe('twse-openapi');
      expect(result.right.tradeDate).toBe('2026-09-07');
    } else {
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it('applies the same freshness rule to TPEX (not TWSE-hardcoded)', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const tpexOfficialBody = [
      {
        Date: '1150907',
        SecuritiesCompanyCode: '006201',
        CompanyName: '元大富櫃50',
        TradingShares: '137950',
        Open: '44.98',
        High: '45.82',
        Low: '44.98',
        Close: '45.41',
        Change: '+1.23',
      },
    ];
    const tpexMisBody = {
      msgArray: [
        {
          c: '006201',
          n: '元大富櫃50',
          ex: 'otc',
          z: '45.00',
          y: '45.41',
          d: '20260908',
          t: '13:30:00',
          o: '44.98',
          h: '45.82',
          l: '44.98',
          v: '137950',
        },
      ],
    };
    const fetchMock = publicDataFetch(tpexOfficialBody, tpexMisBody);
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAt(OVERNIGHT_0909, service().getQuote('006201'));

    expectRightQuote(
      result,
      {
        symbol: '006201',
        name: '元大富櫃50',
        market: 'TPEX',
        price: 45,
        referencePrice: 45.41,
        referencePriceType: 'previous_close',
        change: -0.41,
        changePercent: -0.9,
        tradeDate: '2026-09-08',
        openPrice: 44.98,
        highPrice: 45.82,
        lowPrice: 44.98,
        tradeVolume: 137950,
        tradeVolumeUnit: 'lot',
        limitUpPrice: null,
        limitDownPrice: null,
      },
      {
        provider: 'twse-mis',
        fallbackUsed: true,
        cacheHit: false,
        asOf: null,
      },
    );
    if (Either.isRight(result)) {
      expect(result.right.source.fallbackReason).toBe('config_missing');
    }
  });

  it('accepts a same-day MIS close after the settlement grace (09-08 14:14, MIS 13:30 wins)', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const fetchMock = publicDataFetch(OFFICIAL_0907_BODY, MIS_0908_BODY);
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAt(new Date('2026-09-08T14:14:00+08:00').getTime(), service().getQuote('2330'));

    expectRightQuote(result, EXPECTED_MIS_0908_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: null,
    });
  });

  it('does not treat a same-day MIS close as final inside the grace window (09-08 13:31)', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const fetchMock = publicDataFetch(OFFICIAL_0907_BODY, MIS_0908_BODY);
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAt(new Date('2026-09-08T13:31:00+08:00').getTime(), service().getQuote('2330'));

    if (Either.isRight(result)) {
      expect(result.right.source.provider).toBe('twse-openapi');
      expect(result.right.tradeDate).toBe('2026-09-07');
    } else {
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it('ignores a prior-day MIS snapshot without a completed close (09-08 10:00 at 09-09 01:05)', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const staleIntradayMis = {
      msgArray: [
        {
          c: '2330',
          n: '台積電',
          ex: 'tse',
          z: '34.20',
          y: '34.39',
          d: '20260908',
          t: '10:00:00',
          o: '34.32',
          h: '34.40',
          l: '34.10',
          v: '20000',
        },
      ],
    };
    const fetchMock = publicDataFetch(OFFICIAL_0907_BODY, staleIntradayMis);
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAt(OVERNIGHT_0909, service().getQuote('2330'));

    if (Either.isRight(result)) {
      expect(result.right.source.provider).toBe('twse-openapi');
      expect(result.right.tradeDate).toBe('2026-09-07');
    } else {
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it('ignores an out-of-range MIS session time (99:99:99 cannot prove a close)', async () => {
    vi.stubEnv('FUGLE_API_KEY', '');
    const badTimeMis = {
      msgArray: [
        {
          c: '2330',
          n: '台積電',
          ex: 'tse',
          z: '34.07',
          y: '34.39',
          d: '20260908',
          t: '99:99:99',
          o: '34.35',
          h: '34.35',
          l: '34.04',
          v: '33414',
        },
      ],
    };
    const fetchMock = publicDataFetch(OFFICIAL_0907_BODY, badTimeMis);
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAt(OVERNIGHT_0909, service().getQuote('2330'));

    if (Either.isRight(result)) {
      expect(result.right.source.provider).toBe('twse-openapi');
      expect(result.right.tradeDate).toBe('2026-09-07');
    } else {
      expect(Either.isRight(result)).toBe(true);
    }
  });
});
