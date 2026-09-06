import { Effect, Either, Fiber, TestClock, TestContext } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FugleHttpError, FugleNetworkError, FugleTimeoutError } from './fugle-quote.error.js';
import { FugleQuoteProvider, selectPrimaryError } from './fugle-quote.provider.js';

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
  tradeVolumeUnit: 'lot',
  limitUpPrice: 622,
  limitDownPrice: 510,
};

// Route-aware stub: quote and ticker endpoints get independent bodies.
function okPair(quoteBody: unknown, tickerBody: unknown, status = 200): void {
  statusPair(status, status, quoteBody, tickerBody);
}

// Independent HTTP statuses per endpoint for mixed-failure precedence tests.
function statusPair(quoteStatus: number, tickerStatus: number, quoteBody: unknown, tickerBody: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const isTicker = String(input).includes('/intraday/ticker/');
      const body = isTicker ? tickerBody : quoteBody;
      const status = isTicker ? tickerStatus : quoteStatus;
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
  tradeVolumeUnit: 'lot',
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

  it('fails FugleTimeoutError and aborts both upstream fetches after 3s of silence', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
        if (init?.signal) {
          signals.push(init.signal);
        }
        return new Promise<Response>(() => {});
      }),
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
    // Both in-flight fetches are really cancelled, not just ignored.
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('prefers quote 404 over ticker 429 regardless of completion order', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    statusPair(404, 429, { message: 'not found' }, { message: 'rate limited' });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      if (result.left._tag === 'FugleHttpError') {
        expect(result.left.status).toBe(404);
      }
    }
  });

  it('prefers ticker 404 over quote 429 regardless of completion order', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    statusPair(429, 404, { message: 'rate limited' }, { message: 'not found' });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      if (result.left._tag === 'FugleHttpError') {
        expect(result.left.status).toBe(404);
      }
    }
  });

  it('prefers quote 403 over ticker 503', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    statusPair(403, 503, { message: 'forbidden' }, { message: 'downstream' });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      if (result.left._tag === 'FugleHttpError') {
        expect(result.left.status).toBe(403);
      }
    }
  });

  it('prefers ticker 403 over quote 503', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    statusPair(503, 403, { message: 'downstream' }, { message: 'forbidden' });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      if (result.left._tag === 'FugleHttpError') {
        expect(result.left.status).toBe(403);
      }
    }
  });

  it('prefers ticker 400 over quote 503', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    statusPair(503, 400, { message: 'downstream' }, { message: 'bad request' });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      if (result.left._tag === 'FugleHttpError') {
        expect(result.left.status).toBe(400);
      }
    }
  });
});

describe('selectPrimaryError precedence', () => {
  it('ranks 404 above auth errors above transient errors', () => {
    const notFound = new FugleHttpError({ status: 404 });
    const forbidden = new FugleHttpError({ status: 403 });
    const rateLimited = new FugleHttpError({ status: 429 });

    expect(selectPrimaryError(notFound, rateLimited)).toBe(notFound);
    expect(selectPrimaryError(rateLimited, notFound)).toBe(notFound);
    expect(selectPrimaryError(forbidden, rateLimited)).toBe(forbidden);
    expect(selectPrimaryError(rateLimited, forbidden)).toBe(forbidden);
    expect(selectPrimaryError(new FugleNetworkError(), new FugleTimeoutError())._tag).toBe('FugleNetworkError');
  });

  it('ranks every non-429 4xx above 5xx so the rank mirrors the fallback policy', () => {
    const badRequest = new FugleHttpError({ status: 400 });
    const unprocessable = new FugleHttpError({ status: 422 });
    const unavailable = new FugleHttpError({ status: 503 });

    expect(selectPrimaryError(unavailable, badRequest)).toBe(badRequest);
    expect(selectPrimaryError(unprocessable, unavailable)).toBe(unprocessable);
  });

});
