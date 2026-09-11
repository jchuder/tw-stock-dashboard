import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheModule } from '../../libs/cache/cache.module.js';
import { LoggerModule } from '../../libs/observability/logger.module.js';
import { universeFixtureResponse } from '../../libs/securities/universe.fixtures.js';
import { SecuritiesModule } from './securities.module.js';

import { flushProjectRedisKeys } from '../../libs/cache/cache-test.helper.js';

beforeEach(async () => {
  await flushProjectRedisKeys();
});

function stubUniverse(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const fixture = universeFixtureResponse(String(input));
      if (fixture) return fixture;
      throw new Error(`unexpected universe call: ${String(input)}`);
    }),
  );
}

describe('GET /api/v1/securities', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, CacheModule, SecuritiesModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves ESB, TWSE stock, and ETF metadata in request order', async () => {
    stubUniverse();

    const res = await request(app.getHttpServer()).get('/api/v1/securities?symbols=7883,2330,00981A').expect(200);

    expect(res.body).toEqual([
      { symbol: '7883', name: '饗賓', market: 'ESB', type: 'stock' },
      { symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' },
      { symbol: '00981A', name: '主動統一台股增長', market: 'TWSE', type: 'etf' },
    ]);
  });

  it('skips unknown symbols instead of failing the batch', async () => {
    stubUniverse();

    const res = await request(app.getHttpServer()).get('/api/v1/securities?symbols=2330,999999').expect(200);

    expect(res.body).toEqual([{ symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' }]);
  });

  it('rejects a missing symbols parameter with 400', async () => {
    stubUniverse();

    await request(app.getHttpServer()).get('/api/v1/securities').expect(400);
  });

  it('returns 503 when every universe source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })));

    const res = await request(app.getHttpServer()).get('/api/v1/securities?symbols=2330').expect(503);

    expect(res.body.message).toBe('Security universe temporarily unavailable');
  });
});
