import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggerModule } from '../../libs/observability/logger.module.js';
import { CacheModule } from '../../libs/cache/cache.module.js';
import { UniverseModule } from '../../libs/securities/universe.module.js';
import { StockHistoryModule } from './stock-history.module.js';
import { universeFixtureResponse } from '../../libs/securities/universe.fixtures.js';

function serveUniverseFirst(handler: (input: unknown) => Promise<Response>): (input: unknown) => Promise<Response> {
  return async (input: unknown) => universeFixtureResponse(String(input)) ?? handler(input);
}

// Fixed instant: 2026-08-06 12:00:00 Taipei time (04:00:00 UTC).
// Visible 1m window: 2026-07-06 to 2026-08-06.
// Warmup 4m window starts at 2026-03-06.
const FIXED_NOW = new Date('2026-08-06T04:00:00.000Z');

const FUGLE_FIXTURE = {
  symbol: '2330',
  exchange: 'TWSE',
  data: [
    { date: '2026-08-06', open: 2310, high: 2330, low: 2300, close: 2320, volume: 30123456 },
    { date: '2026-08-05', open: 2300, high: 2320, low: 2280, close: 2310, volume: 28765432 },
  ],
};

const EXPECTED_CANDLES = [
  {
    date: '2026-08-05',
    open: 2300,
    high: 2320,
    low: 2280,
    close: 2310,
    average: null,
    volume: 28765432,
    ma5: null,
    ma10: null,
    ma20: null,
    ma60: null,
  },
  {
    date: '2026-08-06',
    open: 2310,
    high: 2330,
    low: 2300,
    close: 2320,
    average: null,
    volume: 30123456,
    ma5: null,
    ma10: null,
    ma20: null,
    ma60: null,
  },
];

const GENERIC_FAILURE = {
  statusCode: 500,
  message: 'Failed to fetch stock history',
  error: 'Internal Server Error',
};

describe('GET /api/v1/stocks/:symbol/history', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, CacheModule, UniverseModule, StockHistoryModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('defaults to 1m and returns the exact normalized contract ascending with ma fields', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal('fetch', vi.fn(serveUniverseFirst(async () => new Response(JSON.stringify(FUGLE_FIXTURE), { status: 200 }))));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history').expect(200);

    expect(res.body).toEqual({
      symbol: '2330',
      market: 'TWSE',
      range: '1m',
      timeframe: '1d',
      volumeUnit: 'share',
      priceBasis: 'close',
      candles: EXPECTED_CANDLES,
      source: {
        provider: 'fugle',
        mode: 'eod',
        asOf: '2026-08-06',
      },
    });
  });

  it('passes range, timeframe, fields, sort, and warm-up dates to Fugle', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(serveUniverseFirst(async () => new Response(JSON.stringify(FUGLE_FIXTURE), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=3m').expect(200);

    expect(res.body.range).toBe('3m');
    const candleCalls = fetchMock.mock.calls.map(([input]) => String(input)).filter((u) => u.includes('/historical/candles/'));
    expect(candleCalls).toHaveLength(1);
    const url = decodeURIComponent(candleCalls[0] ?? '');
    expect(url).toContain('/historical/candles/2330?');
    expect(url).toContain('timeframe=D');
    expect(url).toContain('fields=open,high,low,close,volume');
    expect(url).toContain('sort=asc');
    // Visible 3m is 2026-05-06 to 2026-08-06; warmup 4m back from 2026-05-06 is 2026-01-06
    expect(url).toContain('from=2026-01-06');
    expect(url).toContain('to=2026-08-06');
  });

  it('calculates MA60 from warm-up history and crops out warm-up candles from response', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');

    // 59 warmup candles prior to 2026-07-06 (visible from), plus 1 visible candle on 2026-07-06
    const warmupCandles = Array.from({ length: 59 }, (_, i) => {
      const month = String(Math.floor(i / 20) + 4).padStart(2, '0');
      const day = String((i % 20) + 1).padStart(2, '0');
      return {
        date: `2026-${month}-${day}`,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1000,
      };
    });
    const visibleCandle = {
      date: '2026-07-06',
      open: 160,
      high: 160,
      low: 160,
      close: 160,
      volume: 2000,
    };

    const mockData = {
      symbol: '2330',
      exchange: 'TWSE',
      data: [...warmupCandles, visibleCandle],
    };

    vi.stubGlobal('fetch', vi.fn(serveUniverseFirst(async () => new Response(JSON.stringify(mockData), { status: 200 }))));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=1m').expect(200);

    // Warmup candles must not leak into response
    expect(res.body.candles).toHaveLength(1);
    expect(res.body.candles[0].date).toBe('2026-07-06');
    expect(res.body.candles.every((c: { date: string }) => c.date >= '2026-07-06')).toBe(true);

    // First visible candle is the 60th candle, so ma60 must be calculated and non-null
    // (59 * 100 + 160) / 60 = 6060 / 60 = 101
    expect(res.body.candles[0].ma60).toBe(101);
  });

  it('rejects an invalid range with 400 without calling upstream', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=banana').expect(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails safe with the frozen shape on upstream 503', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        serveUniverseFirst(async () => new Response(JSON.stringify({ message: 'downstream' }), { status: 503 })),
      ),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });

  it('treats upstream 404 as a generic failure, not a domain signal', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        serveUniverseFirst(async () => new Response(JSON.stringify({ message: 'not found' }), { status: 404 })),
      ),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });
  it('serves 1d as merged 5m history plus current intraday cropped to the last trading day', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(
      serveUniverseFirst(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/intraday/candles/')) {
          return new Response(
            JSON.stringify({
              symbol: '2330',
              exchange: 'TWSE',
              data: [
                {
                  date: '2026-08-06T09:05:00.000+08:00',
                  open: 2320,
                  high: 2325,
                  low: 2318,
                  close: 2322,
                  volume: 1200,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            symbol: '2330',
            exchange: 'TWSE',
            data: [
              { date: '2026-08-05T09:00:00.000+08:00', open: 2300, high: 2310, low: 2295, close: 2305, volume: 900 },
              { date: '2026-08-06T09:00:00.000+08:00', open: 2315, high: 2320, low: 2312, close: 2318, volume: 800 },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=1d').expect(200);

    expect(res.body.range).toBe('1d');
    expect(res.body.timeframe).toBe('5m');
    // Only the last trading day survives the crop, with both sessions merged.
    expect(res.body.candles.map((c: { date: string }) => c.date)).toEqual([
      '2026-08-06T09:00:00.000+08:00',
      '2026-08-06T09:05:00.000+08:00',
    ]);
    const historicalUrl = decodeURIComponent((fetchMock.mock.calls as [string][]).map(([u]) => u).find((u) => u.includes('/historical/candles/')) ?? '');
    expect(historicalUrl).toContain('timeframe=5');
  });

  it('still serves 1d from history alone when the intraday session is empty on a weekend', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        serveUniverseFirst(async (input: unknown) =>
          String(input).includes('/intraday/candles/')
            ? new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
            : new Response(JSON.stringify(FUGLE_FIXTURE), { status: 200 }),
        ),
      ),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=1d').expect(200);

    expect(res.body.timeframe).toBe('5m');
    expect(res.body.candles.length).toBeGreaterThan(0);
  });

  it('splits the 1y warm-up span into sub-year chunks and keeps the full 12-month visible window', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        serveUniverseFirst(async (input: unknown) => {
          seen.push(decodeURIComponent(String(input)));
          return new Response(JSON.stringify(FUGLE_FIXTURE), { status: 200 });
        }),
      ),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=1y').expect(200);
    expect(res.body.range).toBe('1y');
    expect(res.body.timeframe).toBe('1d');
    // Visible 1y is 2025-08-06 to 2026-08-06; warmup 4m back starts 2025-04-06.
    // The 16-month span must be chunked, and the visible window never shortened.
    // Universe bootstrap calls share the stub; only candle queries count here.
    const candleSeen = seen.filter((u) => u.includes('/historical/candles/'));
    expect(candleSeen.length).toBeGreaterThan(1);
    expect(Math.min(...candleSeen.map((u) => Date.parse(u.match(/from=(\d{4}-\d{2}-\d{2})/)?.[1] ?? '')))).toBe(
      Date.parse('2025-04-06'),
    );
    for (const url of candleSeen) {
      const from = Date.parse(url.match(/from=(\d{4}-\d{2}-\d{2})/)?.[1] ?? '');
      const to = Date.parse(url.match(/to=(\d{4}-\d{2}-\d{2})/)?.[1] ?? '');
      expect((to - from) / 86_400_000).toBeLessThan(365);
    }
  });

  it('rejects intraday range 1d with 400 when FUGLE_API_KEY is missing without calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=1d').expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      message: 'Intraday 5-minute candles require Fugle API Key',
      error: 'Bad Request',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves daily history from TWSE official data when FUGLE_API_KEY is missing', async () => {
    const twseData = {
      stat: 'OK',
      data: [
        ['115/07/01', '10,000,000', '1,000,000', '1,000.00', '1,050.00', '990.00', '1,040.00', '+40.00', '1,000'],
        ['115/08/06', '12,000,000', '1,200,000', '1,040.00', '1,060.00', '1,030.00', '1,050.00', '+10.00', '1,200'],
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        serveUniverseFirst(async (input: unknown) => {
          const url = String(input);
          if (url.includes('twse.com.tw')) {
            return new Response(JSON.stringify(twseData), { status: 200 });
          }
          return new Response('Not Found', { status: 404 });
        }),
      ),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=1m').expect(200);

    expect(res.body.symbol).toBe('2330');
    expect(res.body.market).toBe('TWSE');
    expect(res.body.range).toBe('1m');
    expect(res.body.timeframe).toBe('1d');
    expect(res.body.source).toEqual({
      provider: 'twse',
      mode: 'eod',
      asOf: '2026-08-06',
    });
    expect(res.body.candles.length).toBeGreaterThan(0);
  });
  it('routes a resolved TPEX security to official TPEx history', async () => {
    const tpexData = {
      stat: 'ok',
      tables: [
        {
          data: [
            ['115/08/06', '2,000', '200,000', '102.00', '104.00', '101.00', '103.00', '+1.00', '600'],
          ],
        },
      ],
    };
    const fetchMock = vi.fn(
      serveUniverseFirst(async (input: unknown) => {
        const url = String(input);
        if (url.includes('tpex.org.tw')) {
          return new Response(JSON.stringify(tpexData), { status: 200 });
        }
        throw new Error(`unexpected upstream call: ${url}`);
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/6488/history?range=1m').expect(200);

    expect(res.body.symbol).toBe('6488');
    expect(res.body.market).toBe('TPEX');
    expect(res.body.source).toEqual({
      provider: 'tpex',
      mode: 'eod',
      asOf: '2026-08-06',
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('tpex.org.tw'))).toBe(true);
  });
  it('routes ESB daily history to official TPEx average-price history', async () => {
    const fetchMock = vi.fn(
      serveUniverseFirst(async (input: unknown) => {
        const url = String(input);
        if (!url.includes('/emerging/historical')) {
          throw new Error(`unexpected upstream call: ${url}`);
        }
        const requestedDate = decodeURIComponent(new URL(url).searchParams.get('date') ?? '');
        const year = Number(requestedDate.slice(0, 4));
        const month = requestedDate.slice(5, 7);
        const average = 230 + Number(month);
        return new Response(
          JSON.stringify({
            stat: 'ok',
            date: requestedDate.replaceAll('/', ''),
            tables: [
              {
                data: [
                  [
                    `${year - 1911}/${month}/06`,
                    '1,000',
                    '235,000',
                    (average + 5).toFixed(2),
                    (average - 5).toFixed(2),
                    average.toFixed(2),
                    '4',
                    '200',
                    '47,000',
                    '0.00',
                    '0.00',
                    '0.00',
                    '1',
                  ],
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/7883/history?range=1m').expect(200);

    expect(res.body).toMatchObject({
      symbol: '7883',
      market: 'ESB',
      range: '1m',
      timeframe: '1d',
      volumeUnit: 'share',
      priceBasis: 'average',
      source: {
        provider: 'tpex-esb',
        mode: 'eod',
        asOf: '2026-08-06',
      },
    });
    expect(res.body.candles.at(-1)).toMatchObject({
      date: '2026-08-06',
      open: null,
      high: 243,
      low: 233,
      close: null,
      average: 238,
      volume: 1200,
      ma5: 236,
    });
  });
  it('rejects ESB intraday history even when Fugle is configured', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(
      serveUniverseFirst(async (input: unknown) => {
        const url = String(input);
        if (url.includes('api.fugle.tw')) {
          throw new Error(`unexpected Fugle history call: ${url}`);
        }
        throw new Error(`unexpected upstream call: ${url}`);
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/7883/history?range=1d').expect(400);

    expect(res.body.message).toBe('興櫃目前提供官方日均價資料，暫不提供 5 分 K');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('api.fugle.tw'))).toBe(false);
  });

  it('does NOT fallback to official provider when Fugle returns 400 bad request', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(
      serveUniverseFirst(async (input: unknown) => {
        const url = String(input);
        if (url.includes('api.fugle.tw')) {
          return new Response('Bad Request', { status: 400 });
        }
        return new Response('Should not be called', { status: 500 });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=1m').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
    // Verified that official TWSE/TPEx was NOT called
    const twseCalls = fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]).includes('twse.com.tw') &&
        !String(call[0]).includes('openapi.twse.com.tw') &&
        !String(call[0]).includes('isin.twse.com.tw'),
    );
    expect(twseCalls.length).toBe(0);
  });

  it('falls back to official provider when Fugle returns 503 service unavailable', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const twseData = {
      stat: 'OK',
      data: [
        ['115/07/01', '10,000,000', '1,000,000', '1,000.00', '1,050.00', '990.00', '1,040.00', '+40.00', '1,000'],
        ['115/08/06', '12,000,000', '1,200,000', '1,040.00', '1,060.00', '1,030.00', '1,050.00', '+10.00', '1,200'],
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        serveUniverseFirst(async (input: unknown) => {
          const url = String(input);
          if (url.includes('api.fugle.tw')) {
            return new Response('Service Unavailable', { status: 503 });
          }
          if (url.includes('twse.com.tw')) {
            return new Response(JSON.stringify(twseData), { status: 200 });
          }
          return new Response('Not Found', { status: 404 });
        }),
      ),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=1m').expect(200);

    expect(res.body.source).toEqual({
      provider: 'twse',
      mode: 'eod',
      asOf: '2026-08-06',
    });
    expect(res.body.candles.length).toBeGreaterThan(0);
  });

  it('treats placeholder key your_fugle_api_key_here as unconfigured and falls back to official provider without calling Fugle', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'your_fugle_api_key_here');
    const twseData = {
      stat: 'OK',
      data: [
        ['115/07/01', '10,000,000', '1,000,000', '1,000.00', '1,050.00', '990.00', '1,040.00', '+40.00', '1,000'],
        ['115/08/06', '12,000,000', '1,200,000', '1,040.00', '1,060.00', '1,030.00', '1,050.00', '+10.00', '1,200'],
      ],
    };
    const fetchMock = vi.fn(
      serveUniverseFirst(async (input: unknown) => {
        const url = String(input);
        if (url.includes('api.fugle.tw')) {
          return new Response('Unauthorized', { status: 401 });
        }
        if (url.includes('twse.com.tw')) {
          return new Response(JSON.stringify(twseData), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=1m').expect(200);

    expect(res.body.source.provider).toBe('twse');
    const fugleCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('api.fugle.tw'));
    expect(fugleCalls.length).toBe(0);
  });
});
