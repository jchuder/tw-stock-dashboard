import { Effect, Either, Fiber, TestClock, TestContext } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwseMisQuoteProvider } from './twse-mis-quote.provider.js';
const TSE_ENTRY = { c: '2330', n: '台積電', ex: 'tse', z: '568', y: '566' };

function okOnce(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

function run(symbol = '2330') {
  return Effect.runPromise(Effect.either(new TwseMisQuoteProvider().getQuote(symbol)));
}

describe('TwseMisQuoteProvider typed failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes a tse entry to a TWSE quote', async () => {
    okOnce({ msgArray: [TSE_ENTRY] });

    const result = await run();

    expect(result).toEqual(
      Either.right({
        symbol: '2330',
        name: '台積電',
        market: 'TWSE',
        price: 568,
        previousClose: 566,
        change: 2,
        changePercent: 0.35,
      }),
    );
  });

  it('normalizes an otc entry to a TPEX quote without float noise', async () => {
    okOnce({ msgArray: [{ c: '9999', n: '測試', ex: 'otc', z: '100.1', y: '100' }] });

    const result = await run('9999');

    expect(result).toEqual(
      Either.right({
        symbol: '9999',
        name: '測試',
        market: 'TPEX',
        price: 100.1,
        previousClose: 100,
        change: 0.1,
        changePercent: 0.1,
      }),
    );
  });

  it('fails TwseMisDecodeError json stage on invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TwseMisDecodeError');
      expect(result.left).toMatchObject({ stage: 'json' });
    }
  });

  it('fails value stage on non-numeric price', async () => {
    okOnce({ msgArray: [{ ...TSE_ENTRY, z: '-' }] });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TwseMisDecodeError');
      expect(result.left).toMatchObject({ stage: 'value' });
    }
  });

  it('fails value stage when msgArray has no requested symbol', async () => {
    okOnce({ msgArray: [{ ...TSE_ENTRY, c: '9999' }] });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TwseMisDecodeError');
      expect(result.left).toMatchObject({ stage: 'value' });
    }
  });

  it('fails TwseMisNetworkError when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TwseMisNetworkError');
    }
  });

  it('fails TwseMisHttpError with status on 503', async () => {
    okOnce({ message: 'downstream' }, 503);

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TwseMisHttpError');
      expect(result.left).toMatchObject({ status: 503 });
    }
  });

  it('fails TwseMisTimeoutError and aborts fetch after 3s of silence', async () => {
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
        const fiber = yield* Effect.fork(Effect.either(new TwseMisQuoteProvider().getQuote('2330')));
        yield* TestClock.adjust('3 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TwseMisTimeoutError');
    }
    expect(captured?.aborted).toBe(true);
  });
});
