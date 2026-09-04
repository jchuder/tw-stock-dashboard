import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
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

const MIS_FIXTURE = {
  msgArray: [{ c: '2330', n: '台積電', ex: 'tse', z: '568', y: '566' }],
};

// Route-aware upstream stub: Fugle and TWSE MIS get independent behaviors so
// the fallback matrix can assert both the response and who was (not) called.
function mockUpstreams(fugle: Response | Error, mis: Response | Error | null) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const picked = String(input).includes('api.fugle.tw') ? fugle : mis;
    if (picked === null || picked instanceof Error) {
      throw picked ?? new Error('unexpected upstream call');
    }
    return picked;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: Mock, host: string): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(host)).length;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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

  it('maps TPEx exchange to TPEX market', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(200, { ...FUGLE_FIXTURE, symbol: '9999', exchange: 'TPEx' });

    const res = await request(app.getHttpServer()).get('/api/stocks/9999/quote').expect(200);

    expect(res.body).toEqual({ ...EXPECTED_BODY, symbol: '9999', market: 'TPEX' });
  });

  it('fails safe on unknown upstream exchange instead of defaulting market', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(200, { ...FUGLE_FIXTURE, exchange: 'UNKNOWN' });

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });

  it('falls back to MIS on Fugle network failure', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = mockUpstreams(new Error('boom'), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(200);

    expect(res.body).toEqual(EXPECTED_BODY);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(1);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw|otc_2330.tw&json=1&delay=0',
    );
  });

  it('falls back to MIS on Fugle 429', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockUpstreams(jsonResponse({ message: 'rate limited' }, 429), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(200);

    expect(res.body).toEqual(EXPECTED_BODY);
  });

  it('falls back to MIS on Fugle 503', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockUpstreams(jsonResponse({ message: 'downstream' }, 503), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(200);

    expect(res.body).toEqual(EXPECTED_BODY);
  });

  it('falls back to MIS on Fugle invalid schema', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockUpstreams(jsonResponse({ bogus: true }), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(200);

    expect(res.body).toEqual(EXPECTED_BODY);
  });

  it('does not fall back on Fugle 401', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = mockUpstreams(jsonResponse({ message: 'unauthorized' }, 401), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });

  it('does not call any upstream without FUGLE_API_KEY', async () => {
    const fetchMock = mockUpstreams(jsonResponse(FUGLE_FIXTURE), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns generic 500 when both Fugle and MIS fail', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockUpstreams(jsonResponse({ message: 'rate limited' }, 429), jsonResponse({ message: 'down' }, 503));

    const res = await request(app.getHttpServer()).get('/api/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });
});
