import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StockQuoteModule } from './stock-quote.module.js';

// Trimmed Fugle intraday quote fixture (official example values for 2330,
// plus raw-only fields that must never leak into our contract).
const FUGLE_FIXTURE = {
  symbol: '2330',
  name: '台積電',
  exchange: 'TWSE',
  lastPrice: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
  bids: [{ price: 567, size: 87 }],
  serial: 6652422,
};

const EXPECTED_BODY = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
};
const GENERIC_FAILURE = {
  statusCode: 500,
  message: 'Failed to fetch stock quote',
  error: 'Internal Server Error',
};

function mockFugle(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

describe('GET /api/stocks/:symbol/quote', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StockQuoteModule],
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

  it('decodes Fugle, normalizes, and returns the exact contract', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(FUGLE_FIXTURE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(200).expect(EXPECTED_BODY);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/2330',
      { headers: { 'X-API-KEY': 'test-api-key' } },
    );
  });

  it('fails safe without leaking when FUGLE_API_KEY is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails safe without leaking on upstream non-2xx', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(429, { message: 'rate limited' });

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });

  it('fails safe without leaking on invalid upstream schema', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(200, { bogus: true, serial: 1 });

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });
});
