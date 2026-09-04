import { Effect, Either, Fiber, TestClock, TestContext } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FugleQuoteProvider } from './fugle-quote.provider.js';

const VALID_UPSTREAM = {
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

  it('returns Right quote result with null asOf when lastUpdated is absent', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce(VALID_UPSTREAM);

    const result = await run();

    expect(result).toEqual(Either.right({ quote: EXPECTED_QUOTE, asOf: null }));
  });

  it('maps valid lastUpdated microseconds to asOf ISO', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ ...VALID_UPSTREAM, lastUpdated: 1685338200000000 });

    const result = await run();

    expect(result).toEqual(
      Either.right({ quote: EXPECTED_QUOTE, asOf: '2023-05-29T05:30:00.000Z' }),
    );
  });

  it('degrades malformed lastUpdated to null without failing the quote', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ ...VALID_UPSTREAM, lastUpdated: 'not-a-timestamp' });

    const result = await run();

    expect(result).toEqual(Either.right({ quote: EXPECTED_QUOTE, asOf: null }));
  });

  it('degrades out-of-range lastUpdated to null without throwing RangeError', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ ...VALID_UPSTREAM, lastUpdated: Number.MAX_VALUE });

    const result = await run();

    expect(result).toEqual(Either.right({ quote: EXPECTED_QUOTE, asOf: null }));
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
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

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
      expect(result.left).toMatchObject({ status: 429 });
    }
  });

  it('fails FugleHttpError with status on 503', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ message: 'downstream' }, 503);

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHttpError');
      expect(result.left).toMatchObject({ status: 503 });
    }
  });

  it('fails FugleDecodeError json stage on invalid JSON', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleDecodeError');
      expect(result.left).toMatchObject({ stage: 'json' });
    }
  });

  it('fails FugleDecodeError schema stage on invalid shape', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ bogus: true });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleDecodeError');
      expect(result.left).toMatchObject({ stage: 'schema' });
    }
  });

  it('fails FugleTimeoutError and aborts fetch after 3s of silence', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    let captured: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
        captured = init?.signal;
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
    expect(captured?.aborted).toBe(true);
  });
});
