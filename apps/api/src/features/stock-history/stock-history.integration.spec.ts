import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggerModule } from '../../libs/observability/logger.module.js';
import { StockHistoryModule } from './stock-history.module.js';

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
      imports: [LoggerModule, StockHistoryModule],
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(FUGLE_FIXTURE), { status: 200 })));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history').expect(200);

    expect(res.body).toEqual({
      symbol: '2330',
      market: 'TWSE',
      range: '1m',
      candles: EXPECTED_CANDLES,
    });
  });

  it('passes range, timeframe, fields, sort, and warm-up dates to Fugle', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(FUGLE_FIXTURE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history?range=3m').expect(200);

    expect(res.body.range).toBe('3m');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [rawUrl] = fetchMock.mock.calls[0] as [string];
    const url = decodeURIComponent(rawUrl);
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

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(mockData), { status: 200 })));

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
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'downstream' }), { status: 503 })),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });

  it('treats upstream 404 as a generic failure, not a domain signal', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'not found' }), { status: 404 })),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/history').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });
});
