import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LoggerModule } from '../../libs/observability/logger.module.js';
import { MarketOverviewModule } from './market-overview.module.js';

const MOCK_TWSE_MI_INDEX = [
  {
    日期: '1150904',
    指數: '寶島股價指數',
    收盤指數: '51,618.00',
    漲跌: '+',
    漲跌點數: '779.72',
    漲跌百分比: '1.53',
  },
  {
    日期: '1150904',
    指數: '發行量加權股價指數',
    收盤指數: '46,551.13',
    漲跌: '+',
    漲跌點數: '693.47',
    漲跌百分比: '1.51',
  },
];

const MOCK_TPEX_INDEX = [
  {
    Date: '20260904',
    Open: '398.83',
    High: '405.64',
    Low: '394.59',
    Close: '402.48',
    Change: '7.23',
  },
  {
    Date: '20260903',
    Open: '407.50',
    High: '411.77',
    Low: '394.74',
    Close: '395.25',
    Change: '-11.71',
  },
];

const MOCK_TWSE_BFI82U = {
  stat: 'OK',
  date: '20260904',
  title: '115年09月04日 三大法人買賣金額統計表',
  fields: ['單位名稱', '買進金額', '賣出金額', '買賣差額'],
  data: [
    ['自營商(自行買賣)', '10,206,863,465', '8,700,559,652', '1,506,303,813'],
    ['自營商(避險)', '28,556,071,254', '23,692,313,823', '4,863,757,431'],
    ['投信', '14,968,188,503', '15,879,054,966', '-910,866,463'],
    ['外資及陸資(不含外資自營商)', '362,796,136,864', '306,583,183,061', '56,212,953,803'],
    ['外資自營商', '0', '0', '0'],
    ['合計', '416,527,260,086', '354,855,111,502', '61,672,148,584'],
  ],
};

describe('GET /api/v1/market/overview', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, MarketOverviewModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns 200 with normalized market overview on happy path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes('MI_INDEX')) {
          return new Response(JSON.stringify(MOCK_TWSE_MI_INDEX), { status: 200 });
        }
        if (url.includes('tpex_index')) {
          return new Response(JSON.stringify(MOCK_TPEX_INDEX), { status: 200 });
        }
        if (url.includes('BFI82U')) {
          return new Response(JSON.stringify(MOCK_TWSE_BFI82U), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/market/overview');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      taiex: {
        asOf: '2026-09-04',
        close: 46551.13,
        change: 693.47,
        changePercent: 1.51,
      },
      otc: {
        asOf: '2026-09-04',
        close: 402.48,
        change: 7.23,
        changePercent: 1.83,
      },
      institutional: {
        asOf: '2026-09-04',
        market: 'TWSE',
        foreignNetAmount: 56212953803,
        investmentTrustNetAmount: -910866463,
        dealerNetAmount: 6370061244,
        totalNetAmount: 61672148584,
      },
    });
  });

  it('returns 500 if any upstream provider fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes('MI_INDEX')) {
          return new Response('Server Error', { status: 500 });
        }
        if (url.includes('tpex_index')) {
          return new Response(JSON.stringify(MOCK_TPEX_INDEX), { status: 200 });
        }
        if (url.includes('BFI82U')) {
          return new Response(JSON.stringify(MOCK_TWSE_BFI82U), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }),
    );

    const res = await request(app.getHttpServer()).get('/api/v1/market/overview');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Failed to fetch market overview',
      error: 'Internal Server Error',
    });
  });
});
