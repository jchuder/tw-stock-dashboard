import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LoggerModule } from '../../libs/observability/logger.module.js';
import { StockHistoryModule } from './stock-history.module.js';

// Upstream deliberately in descending order: the contract guarantees
// ascending, so this also proves the provider sorts rather than trusts.
const FUGLE_FIXTURE = {
  symbol: '2330',
  exchange: 'TWSE',
  data: [
    { date: '2026-08-06', open: 2310, high: 2330, low: 2300, close: 2320, volume: 30123456 },
    { date: '2026-08-05', open: 2300, high: 2320, low: 2280, close: 2310, volume: 28765432 },
  ],
};

const EXPECTED_CANDLES = [
  { date: '2026-08-05', open: 2300, high: 2320, low: 2280, close: 2310, volume: 28765432 },
  { date: '2026-08-06', open: 2310, high: 2330, low: 2300, close: 2320, volume: 30123456 },
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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('defaults to 1m and returns the exact normalized contract ascending', async () => {
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

  it('passes range, timeframe, fields, sort, and dates to Fugle', async () => {
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
    expect(url).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(url).toMatch(/to=\d{4}-\d{2}-\d{2}/);
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
