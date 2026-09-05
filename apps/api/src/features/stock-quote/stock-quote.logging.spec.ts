import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggerModule } from '../../libs/observability/logger.module.js';
import { StockQuoteCache } from './stock-quote.cache.js';
import { StockQuoteModule } from './stock-quote.module.js';

interface CapturedLog {
  level: 'info' | 'warn' | 'error';
  entry: Record<string, unknown>;
}

function captureLogger(captured: CapturedLog[]) {
  return {
    info: (entry: Record<string, unknown>) => {
      captured.push({ level: 'info', entry });
    },
    warn: (entry: Record<string, unknown>) => {
      captured.push({ level: 'warn', entry });
    },
    error: (entry: Record<string, unknown>) => {
      captured.push({ level: 'error', entry });
    },
  };
}

function entriesOf(captured: CapturedLog[], level: CapturedLog['level'], event: string) {
  return captured.filter((log) => log.level === level && log.entry.event === event).map((log) => log.entry);
}

const FUGLE_BODY = {
  symbol: '2330',
  name: '台積電',
  exchange: 'TWSE',
  lastPrice: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
};

const MIS_BODY = { msgArray: [{ c: '2330', n: '台積電', ex: 'tse', z: '568', y: '566' }] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('stock quote domain logs', () => {
  let app: INestApplication;
  let captured: CapturedLog[];

  beforeAll(async () => {
    captured = [];
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, StockQuoteModule],
    })
      .overrideProvider(PinoLogger)
      .useValue(captureLogger(captured))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    app.get(StockQuoteCache).clear();
    captured.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('logs one served event for a Fugle success', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(FUGLE_BODY)));

    await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expect(entriesOf(captured, 'info', 'market_data_quote_served')).toEqual([
      {
        event: 'market_data_quote_served',
        operation: 'quote',
        symbol: '2330',
        provider: 'fugle',
        fallback_used: false,
        cache_hit: false,
      },
    ]);
    expect(entriesOf(captured, 'warn', 'market_data_fallback')).toEqual([]);
  });

  it('logs fallback once and served as twse-mis on Fugle 429', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('api.fugle.tw')
          ? jsonResponse({ message: 'rate limited' }, 429)
          : jsonResponse(MIS_BODY),
      ),
    );

    await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expect(entriesOf(captured, 'warn', 'market_data_fallback')).toEqual([
      {
        event: 'market_data_fallback',
        operation: 'quote',
        symbol: '2330',
        from_provider: 'fugle',
        to_provider: 'twse-mis',
        reason: 'http_429',
        upstream_status: 429,
      },
    ]);
    expect(entriesOf(captured, 'info', 'market_data_quote_served')).toEqual([
      {
        event: 'market_data_quote_served',
        operation: 'quote',
        symbol: '2330',
        provider: 'twse-mis',
        fallback_used: true,
        cache_hit: false,
      },
    ]);
  });

  it('logs served cache_hit without a second fallback event', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) =>
        String(input).includes('api.fugle.tw')
          ? jsonResponse({ message: 'rate limited' }, 429)
          : jsonResponse(MIS_BODY),
      ),
    );

    await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);
    await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(200);

    expect(entriesOf(captured, 'warn', 'market_data_fallback')).toHaveLength(1);
    expect(entriesOf(captured, 'info', 'market_data_quote_served')).toEqual([
      {
        event: 'market_data_quote_served',
        operation: 'quote',
        symbol: '2330',
        provider: 'twse-mis',
        fallback_used: true,
        cache_hit: false,
      },
      {
        event: 'market_data_quote_served',
        operation: 'quote',
        symbol: '2330',
        provider: 'twse-mis',
        fallback_used: true,
        cache_hit: true,
      },
    ]);
  });

  it('logs a failed event with safe fields on final 401', async () => {
    vi.stubEnv('FUGLE_API_KEY', 'test-api-key');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'unauthorized' }, 401)));

    const res = await request(app.getHttpServer()).get('/api/v1/stocks/2330/quote').expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Failed to fetch stock quote',
      error: 'Internal Server Error',
    });
    expect(entriesOf(captured, 'error', 'market_data_quote_failed')).toEqual([
      {
        event: 'market_data_quote_failed',
        operation: 'quote',
        symbol: '2330',
        provider: 'fugle',
        error_type: 'FugleHttpError',
        upstream_status: 401,
      },
    ]);
  });
});
