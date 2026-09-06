import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { StockQuoteCache } from './stock-quote.cache.js';
import { StockQuoteModule } from './stock-quote.module.js';
import { LoggerModule } from '../../libs/observability/logger.module.js';

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

const EXPECTED_QUOTE = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
  tradeDate: null,
  openPrice: null,
  highPrice: null,
  lowPrice: null,
  tradeVolume: null,
  tradeVolumeUnit: 'lot',
  limitUpPrice: null,
  limitDownPrice: null,
};
const GENERIC_FAILURE = {
  statusCode: 500,
  message: 'Failed to fetch stock quote',
  error: 'Internal Server Error',
};

interface ExpectedSource {
  provider: 'fugle' | 'twse-mis';
  fallbackUsed: boolean;
  cacheHit: boolean;
  asOf: string | null;
}

// fetchedAt is clock-dependent: checked by ISO-UTC shape, everything else exact.
function expectQuoteBody(body: unknown, quote: Record<string, unknown>, source: ExpectedSource): void {
  expect(body).toMatchObject({ ...quote, source });
  expect((body as { source: { fetchedAt: unknown } }).source.fetchedAt).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
}

// Fresh Response per call: the provider fetches quote + ticker, and a
// consumed body cannot be read twice.
function mockFugle(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

const MIS_FIXTURE = {
  msgArray: [{ c: '2330', n: '台積電', ex: 'tse', z: '568', y: '566' }],
};

// Route-aware upstream stub: Fugle and TWSE MIS get independent behaviors so
// the fallback matrix can assert both the response and who was (not) called.
// Responses are cloned per call: the provider fetches quote + ticker, and a
// consumed body cannot be read twice.
function mockUpstreams(fugle: Response | Error, mis: Response | Error | null) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const picked = String(input).includes('api.fugle.tw') ? fugle : mis;
    if (picked === null || picked instanceof Error) {
      throw picked ?? new Error('unexpected upstream call');
    }
    return picked.clone();
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
describe('GET /api/v1/stocks/:symbol/quote', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, StockQuoteModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    app.get(StockQuoteCache).clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('decodes Fugle, normalizes, and returns the exact contract', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(FUGLE_FIXTURE), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(res.body, EXPECTED_QUOTE, {
      provider: 'fugle',
      fallbackUsed: false,
      cacheHit: false,
      asOf: null,
    });

    // One upstream round: intraday quote + ticker.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/2330',
      { headers: { 'X-API-KEY': 'test-api-key' }, signal: expect.any(AbortSignal) },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/2330',
      { headers: { 'X-API-KEY': 'test-api-key' }, signal: expect.any(AbortSignal) },
    );
  });

  it('fails safe without leaking when FUGLE_API_KEY is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails safe without leaking on upstream non-2xx', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(429, { message: 'rate limited' });

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });

  it('returns HTTP 404 Not Found on Fugle 404 without calling MIS', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = mockUpstreams(
      jsonResponse({ message: 'Resource Not Found' }, 404),
      jsonResponse(MIS_FIXTURE),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/999999/quote').expect(404);

    expect(res.body).toEqual({
      statusCode: 404,
      message: 'Stock not found',
      error: 'Not Found',
    });
    expect(callsTo(fetchMock, 'intraday/quote')).toBe(1);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });

  it('fails safe without leaking on invalid upstream schema', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(200, { bogus: true, serial: 1 });

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });

  it('maps TPEx exchange to TPEX market', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(200, { ...FUGLE_FIXTURE, symbol: '9999', exchange: 'TPEx' });

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/9999/quote').expect(200);

    expectQuoteBody(
      res.body,
      { ...EXPECTED_QUOTE, symbol: '9999', market: 'TPEX' },
      { provider: 'fugle', fallbackUsed: false, cacheHit: false, asOf: null },
    );
  });

  it('fails safe on unknown upstream exchange instead of defaulting market', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(200, { ...FUGLE_FIXTURE, exchange: 'UNKNOWN' });

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
  });

  it('falls back to MIS on Fugle network failure', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = mockUpstreams(new Error('boom'), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(res.body, EXPECTED_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: null,
    });
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(1);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_2330.tw|otc_2330.tw&json=1&delay=0',
    );
  });

  it('falls back to MIS on Fugle 429', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockUpstreams(jsonResponse({ message: 'rate limited' }, 429), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(res.body, EXPECTED_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: null,
    });
  });

  it('falls back to MIS on Fugle 503', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockUpstreams(jsonResponse({ message: 'downstream' }, 503), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(res.body, EXPECTED_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: null,
    });
  });

  it('falls back to MIS on Fugle invalid schema', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockUpstreams(jsonResponse({ bogus: true }), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(res.body, EXPECTED_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: null,
    });
  });

  it('does not fall back on Fugle 401', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = mockUpstreams(jsonResponse({ message: 'unauthorized' }, 401), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });

  it('does not call any upstream without FUGLE_API_KEY', async () => {
    const fetchMock = mockUpstreams(jsonResponse(FUGLE_FIXTURE), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves the second sequential GET from cache with one upstream round', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async () => jsonResponse(FUGLE_FIXTURE));
    vi.stubGlobal('fetch', fetchMock);

    const first = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);
    const second = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(first.body, EXPECTED_QUOTE, {
      provider: 'fugle',
      fallbackUsed: false,
      cacheHit: false,
      asOf: null,
    });
    expectQuoteBody(second.body, EXPECTED_QUOTE, {
      provider: 'fugle',
      fallbackUsed: false,
      cacheHit: true,
      asOf: null,
    });

    // One upstream round: intraday quote + ticker.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
it('reports Fugle asOf from lastUpdated microseconds', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(200, { ...FUGLE_FIXTURE, lastUpdated: 1685338200000000 });

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(res.body, EXPECTED_QUOTE, {
      provider: 'fugle',
      fallbackUsed: false,
      cacheHit: false,
      asOf: '2023-05-29T05:30:00.000Z',
    });
  });

  it('reports MIS asOf from tlong millis string', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockUpstreams(
      jsonResponse({ message: 'rate limited' }, 429),
      jsonResponse({ msgArray: [{ c: '2330', n: '台積電', ex: 'tse', z: '568', y: '566', tlong: '1685338200000' }] }),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(res.body, EXPECTED_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: '2023-05-29T05:30:00.000Z',
    });
  });
it('echoes a valid incoming X-Request-ID on the response', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(200, FUGLE_FIXTURE);

    const res = await request(app.getHttpServer())
      .get('/api/v1/stocks/2330/quote')
      .set('X-Request-ID', 'q6a-test-123')
      .expect(200);

    expect(res.headers['x-request-id']).toBe('q6a-test-123');
  });

  it('generates a response request ID when the incoming one is missing', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    mockFugle(200, FUGLE_FIXTURE);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
  it('normalizes enriched session fields from Quote and limit prices from Ticker', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/intraday/ticker/')) {
        return jsonResponse({
          symbol: '2330',
          name: '台積電',
          exchange: 'TWSE',
          date: '2023-05-29',
          previousClose: 566,
          referencePrice: 566,
          limitUpPrice: 622,
          limitDownPrice: 510,
        });
      }
      return jsonResponse({
        ...FUGLE_FIXTURE,
        date: '2023-05-29',
        openPrice: 574,
        highPrice: 574,
        lowPrice: 564,
        total: { tradeVolume: 54538 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(
      res.body,
      {
        ...EXPECTED_QUOTE,
        tradeDate: '2023-05-29',
        openPrice: 574,
        highPrice: 574,
        lowPrice: 564,
        tradeVolume: 54538,
  tradeVolumeUnit: 'lot',
        limitUpPrice: 622,
        limitDownPrice: 510,
      },
      { provider: 'fugle', fallbackUsed: false, cacheHit: false, asOf: null },
    );
  });

  it('falls back to MIS when the ticker fails transiently while the quote succeeds', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/intraday/ticker/')) {
        return jsonResponse({ message: 'rate limited' }, 429);
      }
      if (String(input).includes('api.fugle.tw')) {
        return jsonResponse(FUGLE_FIXTURE);
      }
      return jsonResponse(MIS_FIXTURE);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expectQuoteBody(res.body, EXPECTED_QUOTE, {
      provider: 'twse-mis',
      fallbackUsed: true,
      cacheHit: false,
      asOf: null,
    });
  });

  it('returns HTTP 404 on ticker 404 without calling MIS', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('api.fugle.tw')) {
        return new Response(JSON.stringify({ message: 'Resource Not Found' }), { status: 404 });
      }
      return jsonResponse(MIS_FIXTURE);
    });
    vi.stubGlobal('fetch', fetchMock);

    await request(app.getHttpServer()).get('/api/v1/stocks/999999/quote').expect(404);

    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });

  it('does not fall back on Fugle 403', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    const fetchMock = mockUpstreams(jsonResponse({ message: 'forbidden' }, 403), jsonResponse(MIS_FIXTURE));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(500);

    expect(res.body).toEqual(GENERIC_FAILURE);
    expect(callsTo(fetchMock, 'mis.twse.com.tw')).toBe(0);
  });
});
