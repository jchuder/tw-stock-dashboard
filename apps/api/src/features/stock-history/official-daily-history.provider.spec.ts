import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { Security } from '@tw-stock-dashboard/contracts';
import type { CacheService } from '../../libs/cache/cache.service.js';
import {
  HISTORY_CACHE_CLOSED_MONTH_TTL_SECONDS,
  HISTORY_CACHE_CURRENT_MONTH_TTL_SECONDS,
  OfficialDailyHistoryProvider,
  monthlyHistoryCacheKey,
  monthlyHistoryCacheTtl,
} from './official-daily-history.provider.js';

type TestCache = Pick<CacheService, 'getJson' | 'setJson' | 'del'>;

const TWSE_SECURITY: Security = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  type: 'stock',
};

const TPEX_SECURITY: Security = {
  symbol: '6488',
  name: '環球晶',
  market: 'TPEX',
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

function createProvider(cache = makeCache()): OfficialDailyHistoryProvider {
  return new OfficialDailyHistoryProvider(cache);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OfficialDailyHistoryProvider', () => {
  it('routes TWSE daily history from resolved security identity without probing TPEx', async () => {
    const twseData = {
      stat: 'OK',
      data: [
        ['115/08/05', '10,000,000', '1,000,000', '1,000.00', '1,050.00', '990.00', '1,040.00', '+40.00', '1,000'],
        ['115/08/06', '12,000,000', '1,200,000', '1,040.00', '1,060.00', '1,030.00', '1,050.00', '+10.00', '1,200'],
      ],
    };
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (!url.includes('twse.com.tw')) {
        throw new Error(`unexpected upstream call: ${url}`);
      }
      return new Response(JSON.stringify(twseData), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(
      createProvider().getDailyHistory(TWSE_SECURITY, '2026-08-01', '2026-08-06'),
    );

    expect(result.symbol).toBe('2330');
    expect(result.market).toBe('TWSE');
    expect(result.provider).toBe('twse');
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0]).toEqual({
      date: '2026-08-05',
      open: 1000,
      high: 1050,
      low: 990,
      close: 1040,
      volume: 10000000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes TPEX daily history from resolved security identity without probing TWSE', async () => {
    const tpexData = {
      stat: 'ok',
      tables: [
        {
          data: [
            ['115/08/05', '1,500', '150,000', '100.00', '105.00', '98.00', '102.00', '+2.00', '500'],
            ['115/08/06', '2,000', '200,000', '102.00', '104.00', '101.00', '103.00', '+1.00', '600'],
          ],
        },
      ],
    };
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (!url.includes('tpex.org.tw')) {
        throw new Error(`unexpected upstream call: ${url}`);
      }
      return new Response(JSON.stringify(tpexData), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(
      createProvider().getDailyHistory(TPEX_SECURITY, '2026-08-01', '2026-08-06'),
    );

    expect(result.symbol).toBe('6488');
    expect(result.market).toBe('TPEX');
    expect(result.provider).toBe('tpex');
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0].volume).toBe(1500000);
    expect(result.candles[1].volume).toBe(2000000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches every requested month from the resolved market', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (!url.includes('tpex.org.tw')) {
        throw new Error(`unexpected upstream call: ${url}`);
      }
      const date = url.includes('2026%2F09%2F01') ? '115/09/01' : '115/08/28';
      return new Response(
        JSON.stringify({
          stat: 'ok',
          tables: [{ data: [[date, '500', '50,000', '100.00', '102.00', '99.00', '101.00', '+1.00', '200']] }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(
      createProvider().getDailyHistory(TPEX_SECURITY, '2026-08-01', '2026-09-02'),
    );

    expect(result.market).toBe('TPEX');
    expect(result.candles).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails with OfficialDailyHistoryError when the resolved provider returns HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Internal Server Error', { status: 500 })));

    const either = await Effect.runPromise(
      Effect.either(createProvider().getDailyHistory(TPEX_SECURITY, '2026-08-01', '2026-08-06')),
    );

    expect(either._tag).toBe('Left');
    if (either._tag === 'Left') {
      expect(either.left._tag).toBe('OfficialDailyHistoryError');
    }
  });

  it('returns an empty successful result when the resolved market has no rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ stat: 'OK', data: [] }), { status: 200 })),
    );

    const result = await Effect.runPromise(
      createProvider().getDailyHistory(TWSE_SECURITY, '2026-08-01', '2026-08-06'),
    );

    expect(result.market).toBe('TWSE');
    expect(result.candles).toEqual([]);
  });

  it('does not cache a TWSE response with an unexpected status', async () => {
    const cache = makeCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ stat: 'ERROR', data: [] }), { status: 200 })),
    );

    const either = await Effect.runPromise(
      Effect.either(createProvider(cache).getDailyHistory(TWSE_SECURITY, '2026-08-01', '2026-08-06')),
    );

    expect(either._tag).toBe('Left');
    if (either._tag === 'Left') {
      expect(either.left._tag).toBe('OfficialDailyHistoryError');
    }
    expect(cache.setJson).not.toHaveBeenCalled();
  });

  it('does not cache a TPEX response with an unexpected status', async () => {
    const cache = makeCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ stat: 'error', tables: [{ data: [] }] }), { status: 200 })),
    );

    const either = await Effect.runPromise(
      Effect.either(createProvider(cache).getDailyHistory(TPEX_SECURITY, '2026-08-01', '2026-08-06')),
    );

    expect(either._tag).toBe('Left');
    if (either._tag === 'Left') {
      expect(either.left._tag).toBe('OfficialDailyHistoryError');
    }
    expect(cache.setJson).not.toHaveBeenCalled();
  });

  it('serves a normalized monthly cache hit without calling upstream', async () => {
    const key = monthlyHistoryCacheKey('twse', '2330', '202608');
    const cachedCandle = {
      date: '2026-08-06',
      open: 1040,
      high: 1060,
      low: 1030,
      close: 1050,
      volume: 12000000,
    };
    const cache = makeCache({ [key]: [cachedCandle] });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await Effect.runPromise(
      createProvider(cache).getDailyHistory(TWSE_SECURITY, '2026-08-01', '2026-08-06'),
    );

    expect(result.candles).toEqual([cachedCandle]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.getJson).toHaveBeenCalledWith(key);
    expect(cache.setJson).not.toHaveBeenCalled();
  });

  it('writes an upstream month using the closed-month TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T04:00:00.000Z'));
    const cache = makeCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            stat: 'OK',
            data: [['115/08/06', '12,000,000', '1,200,000', '1,040.00', '1,060.00', '1,030.00', '1,050.00']],
          }),
          { status: 200 },
        ),
      ),
    );

    await Effect.runPromise(createProvider(cache).getDailyHistory(TWSE_SECURITY, '2026-08-01', '2026-08-06'));

    expect(cache.setJson).toHaveBeenCalledWith(
      monthlyHistoryCacheKey('twse', '2330', '202608'),
      [
        {
          date: '2026-08-06',
          open: 1040,
          high: 1060,
          low: 1030,
          close: 1050,
          volume: 12000000,
        },
      ],
      HISTORY_CACHE_CLOSED_MONTH_TTL_SECONDS,
    );
  });

  it('uses a short TTL for the current Taipei month and a day TTL for closed months', () => {
    const now = Date.parse('2026-08-06T04:00:00.000Z');

    expect(monthlyHistoryCacheTtl('202608', now)).toBe(HISTORY_CACHE_CURRENT_MONTH_TTL_SECONDS);
    expect(monthlyHistoryCacheTtl('202607', now)).toBe(HISTORY_CACHE_CLOSED_MONTH_TTL_SECONDS);
  });

  it('rejects ESB until the dedicated official history provider is added', async () => {
    const esb: Security = { symbol: '7883', name: '饗賓', market: 'ESB', type: 'stock' };

    const either = await Effect.runPromise(
      Effect.either(createProvider().getDailyHistory(esb, '2026-08-01', '2026-08-06')),
    );

    expect(either._tag).toBe('Left');
    if (either._tag === 'Left') {
      expect(either.left._tag).toBe('OfficialDailyHistoryError');
    }
  });
});
