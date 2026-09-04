import { Effect, Either, Fiber, TestClock, TestContext } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { StockQuoteResponse } from '@tw-stock-dashboard/contracts';
import type { FugleQuoteError } from './fugle-quote.error.js';
import { FugleQuoteProvider } from './fugle-quote.provider.js';
import { StockQuoteCache } from './stock-quote.cache.js';
import { StockQuoteService } from './stock-quote.service.js';
import type { TwseMisQuoteError } from './twse-mis-quote.error.js';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';

const MIS_BODY = { msgArray: [{ c: '2330', n: '台積電', ex: 'tse', z: '568', y: '566' }] };

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
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
};

type QuoteResult = Either.Either<StockQuoteResponse, FugleQuoteError | TwseMisQuoteError>;

interface ExpectedSource {
  provider: 'fugle' | 'twse-mis';
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

function service() {
  return new StockQuoteService(new FugleQuoteProvider(), new TwseMisQuoteProvider(), new StockQuoteCache());
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

  it('serves the second request from cache within TTL with one upstream call', async () => {
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures: a 401 then retries upstream', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls += 1;
        if (String(input).includes('api.fugle.tw') && calls === 1) {
          return new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 });
        }
        return new Response(JSON.stringify(FUGLE_BODY), { status: 200 });
      }),
    );
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
    expect(calls).toBe(2);
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
    expect(callsTo(fetchMock, 'api.fugle.tw')).toBe(1);
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
    expect(callsTo(fetchMock, 'api.fugle.tw')).toBe(1);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(1);
  });
});
