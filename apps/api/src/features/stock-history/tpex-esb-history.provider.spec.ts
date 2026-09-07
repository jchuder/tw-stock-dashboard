import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { Security } from '@tw-stock-dashboard/contracts';
import type { CacheService } from '../../libs/cache/cache.service.js';
import { TPEX_ESB_HISTORICAL_URL, TpexEsbHistoryProvider } from './tpex-esb-history.provider.js';

type TestCache = Pick<CacheService, 'getJson' | 'setJson' | 'del'>;

const ESB_SECURITY: Security = {
  symbol: '7883',
  name: '饗賓',
  market: 'ESB',
  type: 'stock',
};

function makeCache(initial: Record<string, unknown> = {}): TestCache {
  const values = new Map(Object.entries(initial));
  return {
    getJson: vi.fn((key: string) => Effect.succeed(values.get(key) ?? null)),
    setJson: vi.fn((key: string, value: unknown) => {
      values.set(key, value);
      return Effect.succeed(undefined);
    }),
    del: vi.fn(() => Effect.succeed(undefined)),
  };
}

function createProvider(cache = makeCache()): TpexEsbHistoryProvider {
  return new TpexEsbHistoryProvider(cache);
}

function response(data: unknown[], date = '20260801'): Response {
  return new Response(
    JSON.stringify({
      stat: 'ok',
      date,
      tables: [{ data }],
    }),
    { status: 200 },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TpexEsbHistoryProvider', () => {
  it('parses first-group prices and sums both group volumes', async () => {
    const cache = makeCache();
    const fetchMock = vi.fn(async (input: unknown) => {
      expect(String(input)).toContain(TPEX_ESB_HISTORICAL_URL);
      expect(String(input)).toContain('code=7883');
      expect(String(input)).toContain('date=2026%2F08%2F01');
      return response([
        ['115/08/05', '1,000', '235,000', '240.00', '230.00', '235.00', '4', '200', '47,000', '239.00', '231.00', '235.50', '1'],
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(
      createProvider(cache).getDailyHistory(ESB_SECURITY, '2026-08-01', '2026-08-31'),
    );

    expect(result.market).toBe('ESB');
    expect(result.provider).toBe('tpex-esb');
    expect(result.candles).toEqual([
      {
        date: '2026-08-05',
        open: null,
        high: 240,
        low: 230,
        close: null,
        average: 235,
        volume: 1200,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.setJson).toHaveBeenCalledWith('history:esb:7883:202608', expect.any(Array), expect.any(Number));
  });

  it('keeps second-group volume but does not derive prices when first group has no volume', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response([
          ['115/08/06', '0', '0', '0.00', '0.00', '0.00', '0', '700', '84,000', '122.00', '118.00', '120.00', '1'],
        ]),
      ),
    );

    const result = await Effect.runPromise(
      createProvider().getDailyHistory(ESB_SECURITY, '2026-08-01', '2026-08-31'),
    );

    expect(result.candles[0]).toMatchObject({
      date: '2026-08-06',
      high: null,
      low: null,
      average: null,
      volume: 700,
    });
  });

  it('rejects a response whose month differs from the requested month without caching it', async () => {
    const cache = makeCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          [['115/08/05', '1,000', '235,000', '240.00', '230.00', '235.00', '4', '0', '0', '0.00', '0.00', '0.00', '0']],
          '20260701',
        ),
      ),
    );

    const either = await Effect.runPromise(
      Effect.either(createProvider(cache).getDailyHistory(ESB_SECURITY, '2026-08-01', '2026-08-31')),
    );

    expect(either._tag).toBe('Left');
    if (either._tag === 'Left') {
      expect(either.left._tag).toBe('OfficialDailyHistoryError');
    }
    expect(cache.setJson).not.toHaveBeenCalled();
  });

  it('rejects an unexpected response status without caching it', async () => {
    const cache = makeCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ stat: 'error', date: '20260801', tables: [{ data: [] }] }),
          { status: 200 },
        ),
      ),
    );

    const either = await Effect.runPromise(
      Effect.either(createProvider(cache).getDailyHistory(ESB_SECURITY, '2026-08-01', '2026-08-31')),
    );

    expect(either._tag).toBe('Left');
    expect(cache.setJson).not.toHaveBeenCalled();
  });
});
