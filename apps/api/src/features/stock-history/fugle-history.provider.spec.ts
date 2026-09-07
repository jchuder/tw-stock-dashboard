import { Effect, Either, Fiber, TestClock, TestContext } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FugleHistoryProvider } from './fugle-history.provider.js';

const VALID_UPSTREAM = {
  symbol: '2330',
  exchange: 'TWSE',
  data: [
    { date: '2026-08-05', open: 2300, high: 2320, low: 2280, close: 2310, volume: 28765432 },
    { date: '2026-08-06', open: 2310, high: 2330, low: 2300, close: 2320, volume: 30123456 },
  ],
};

const EXPECTED_RESPONSE = {
  symbol: '2330',
  market: 'TWSE',
  candles: [
    { date: '2026-08-05', open: 2300, high: 2320, low: 2280, close: 2310, volume: 28765432 },
    { date: '2026-08-06', open: 2310, high: 2330, low: 2300, close: 2320, volume: 30123456 },
  ],
};

function okOnce(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

function run(symbol = '2330', from = '2026-08-05', to = '2026-08-06') {
  return Effect.runPromise(Effect.either(new FugleHistoryProvider().getHistory(symbol, from, to)));
}

describe('FugleHistoryProvider typed failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns Right normalized ascending history', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID_UPSTREAM), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await run();

    expect(result).toEqual(Either.right(EXPECTED_RESPONSE));
    const [rawUrl] = fetchMock.mock.calls[0] as unknown as [string];
    const url = decodeURIComponent(rawUrl);
    expect(url).toContain('/historical/candles/2330?');
    expect(url).toContain('timeframe=D');
    expect(url).toContain('fields=open,high,low,close,volume');
    expect(url).toContain('sort=asc');
    expect(url).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(url).toMatch(/to=\d{4}-\d{2}-\d{2}/);
  });

  it('sorts descending upstream data into ascending contract order', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ ...VALID_UPSTREAM, data: [...VALID_UPSTREAM.data].reverse() });

    const result = await run();

    expect(result).toEqual(Either.right(EXPECTED_RESPONSE));
  });

  it('maps TPEx exchange to TPEX market', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ ...VALID_UPSTREAM, symbol: '9999', exchange: 'TPEx' });

    const result = await run('9999');

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.market).toBe('TPEX');
      expect(result.right.symbol).toBe('9999');
    }
  });

  it('fails FugleHistoryConfigError when FUGLE_API_KEY is missing', async () => {
    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHistoryConfigError');
    }
  });

  it('fails FugleHistoryNetworkError when fetch rejects', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHistoryNetworkError');
    }
  });

  it('fails FugleHistoryTimeoutError and aborts fetch after 3s of silence', async () => {
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
        const fiber = yield* Effect.fork(
          Effect.either(new FugleHistoryProvider().getHistory('2330', '2026-08-05', '2026-08-06')),
        );
        yield* TestClock.adjust('3 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHistoryTimeoutError');
    }
    expect(captured?.aborted).toBe(true);
  });

  it('fails FugleHistoryHttpError with status on 429', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ message: 'rate limited' }, 429);

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHistoryHttpError');
      expect(result.left).toMatchObject({ status: 429 });
    }
  });

  it('fails FugleHistoryDecodeError json stage on invalid JSON', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHistoryDecodeError');
    }
  });

  it('fails FugleHistoryDecodeError on invalid candle shape', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ symbol: '2330', exchange: 'TWSE', data: [{ date: '2026-08-05', open: 'bad' }] });

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('FugleHistoryDecodeError');
    }
  });

  it('requests timeframe 5 for completed-session 5m history', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(VALID_UPSTREAM), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(
      Effect.either(new FugleHistoryProvider().getHistorical5m('2330', '2026-08-16', '2026-08-22')),
    );

    expect(Either.isRight(result)).toBe(true);
    const [rawUrl] = fetchMock.mock.calls[0] as unknown as [string];
    const url = decodeURIComponent(rawUrl);
    expect(url).toContain('/historical/candles/2330?');
    expect(url).toContain('timeframe=5');
    expect(url).toContain('from=2026-08-16');
  });

  it('returns current-session intraday 5m candles without from/to', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        symbol: '2330',
        exchange: 'TWSE',
        data: [
          { date: '2026-08-06T09:05:00.000+08:00', open: 2, high: 2, low: 2, close: 2, volume: 20 },
          { date: '2026-08-06T09:00:00.000+08:00', open: 1, high: 1, low: 1, close: 1, volume: 10 },
        ],
      }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(Effect.either(new FugleHistoryProvider().getIntraday5m('2330')));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.candles.map((c) => c.date)).toEqual([
        '2026-08-06T09:00:00.000+08:00',
        '2026-08-06T09:05:00.000+08:00',
      ]);
    }
    const [rawUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(decodeURIComponent(rawUrl)).toContain('/intraday/candles/2330?');
  });

  it('degrades intraday 404 to an empty session instead of failing the range', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    okOnce({ message: 'not found' }, 404);

    const result = await Effect.runPromise(Effect.either(new FugleHistoryProvider().getIntraday5m('2330')));

    expect(result).toEqual(Either.right({ symbol: '2330', market: 'TWSE', candles: [] }));
  });
});
