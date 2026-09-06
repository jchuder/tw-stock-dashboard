import { Effect, Either, Fiber, TestClock, TestContext } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FugleQuoteProvider } from './fugle-quote.provider.js';

// Full-session quote: every intraday field present.
const VALID_QUOTE = {
  symbol: '2330',
  name: '台積電',
  exchange: 'TWSE',
  date: '2023-05-29',
  lastPrice: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
  openPrice: 574,
  highPrice: 574,
  lowPrice: 564,
  total: { tradeVolume: 54538 },
};

const VALID_TICKER = {
  symbol: '2330',
  name: '台積電',
  exchange: 'TWSE',
  date: '2023-05-29',
  previousClose: 566,
  referencePrice: 566,
  limitUpPrice: 622,
  limitDownPrice: 510,
};

const EXPECTED_QUOTE = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
  tradeDate: '2023-05-29',
  openPrice: 574,
  highPrice: 574,
  lowPrice: 564,
  tradeVolume: 54538,
  limitUpPrice: 622,
  limitDownPrice: 510,
};

// Route-aware stub: quote and ticker endpoints get independent bodies.
function okPair(quoteBody: unknown, tickerBody: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes('/intraday/ticker/') ? tickerBody : quoteBody;
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

function okOnce(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

function run(symbol = '2330') {
  return Effect.runPromise(Effect.either(new FugleQuoteProvider().getQuote(symbol)));
}

describe('FugleQuoteProvider typed failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('merges Quote and Ticker into one enriched quote with null asOf when lastUpdated is absent', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okPair(VALID_QUOTE, VALID_TICKER);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.quote).toEqual(EXPECTED_QUOTE);
      expect(result.right.asOf).toBeNull();
    }
  });

  it('degrades pre-market missing session fields to null without failing the quote', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const preMarketQuote = {
      symbol: '2330',
      name: '台積電',
      exchange: 'TWSE',
      lastPrice: 568,
      previousClose: 566,
      change: 0,
      changePercent: 0,
    };
    okPair(preMarketQuote, VALID_TICKER);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.quote).toMatchObject({
        tradeDate: '2023-05-29',
        openPrice: null,
        highPrice: null,
        lowPrice: null,
        tradeVolume: null,
      });
    }
  });

  it('degrades malformed lastUpdated to null without failing the quote', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okPair({ ...VALID_QUOTE, lastUpdated: 'not-a-number' }, VALID_TICKER);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.asOf).toBeNull();
    }
  });

  it('degrades out-of-range lastUpdated to null without throwing RangeError', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okPair({ ...VALID_QUOTE, lastUpdated: 999999999999999999999 }, VALID_TICKER);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.asOf).toBeNull();
    }
  });


  it('degrades missing ticker limit prices to null without failing the quote', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const tickerNoLimits = { ...VALID_TICKER, limitUpPrice: null, limitDownPrice: null };
    okPair(VALID_QUOTE, tickerNoLimits);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.quote.limitUpPrice).toBeNull();
      expect(result.right.quote.limitDownPrice).toBeNull();
    }
  });

  it('falls back to closePrice when lastPrice is absent', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const quoteNoLast = { ...VALID_QUOTE, lastPrice: null, closePrice: 568 };
    okPair(quoteNoLast, VALID_TICKER);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.quote.price).toBe(568);
    }
  });

  it('falls back to ticker referencePrice when quote previousClose is absent', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const quoteNoPrev = { ...VALID_QUOTE, previousClose: null };
    okPair(quoteNoPrev, VALID_TICKER);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.quote.previousClose).toBe(566);
    }
  });

  it('fails FugleDecodeError when neither price source exists', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const quoteNoPrice = { ...VALID_QUOTE, lastPrice: null };
    okPair(quoteNoPrice, VALID_TICKER);

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleDecodeError');
    }
  });

  it('fails FugleConfigError when FUGLE_API_KEY is missing', async () => {
    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleConfigError');
    }
  });

  it('fails FugleNetworkError when fetch rejects', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('boom')),
    );

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleNetworkError');
    }
  });

  it('fails FugleHttpError with status on 429', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ message: 'rate limited' }, 429);

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      if (result.left._tag === 'FugleHttpError') {
        expect(result.left.status).toBe(429);
      }
    }
  });

  it('fails FugleHttpError with status on ticker 404 while quote succeeds', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('/intraday/ticker/')
          ? new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
          : new Response(JSON.stringify(VALID_QUOTE), { status: 200 }),
      ),
    );

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      if (result.left._tag === 'FugleHttpError') {
        expect(result.left.status).toBe(404);
      }
    }
  });

  it('fails FugleHttpError with status on 503', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ message: 'downstream' }, 503);

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      if (result.left._tag === 'FugleHttpError') {
        expect(result.left.status).toBe(503);
      }
    }
  });

  it('fails FugleDecodeError json stage on invalid JSON', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleDecodeError');
    }
  });

  it('fails FugleDecodeError schema stage on invalid shape', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ bogus: true });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleDecodeError');
    }
  });

  it('fails FugleTimeoutError and aborts fetch after 3s of silence', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(Effect.either(new FugleQuoteProvider().getQuote('2330')));
        yield* TestClock.adjust('3 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleTimeoutError');
    }
  });
});
