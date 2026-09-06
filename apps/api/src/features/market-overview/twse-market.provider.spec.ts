import { Effect, Either } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRocDate } from './market-overview.schema.js';
import { TwseMarketProvider } from './twse-market.provider.js';

describe('TwseMarketProvider', () => {
  const provider = new TwseMarketProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('TAIEX', () => {
    it('ROC date pure parser converts to ISO date', () => {
      expect(parseRocDate('1150904')).toBe('2026-09-04');
      expect(parseRocDate('990101')).toBe('2010-01-01');
    });

    it('finds TAIEX row by name instead of fixed array position, with comma parsing', async () => {
      const mockPayload = [
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

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockPayload), { status: 200 }),
      );

      const result = await Effect.runPromise(Effect.either(provider.getTaiex()));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right).toEqual({
          asOf: '2026-09-04',
          close: 46551.13,
          change: 693.47,
          changePercent: 1.51,
        });
      }
    });

    it('correctly handles negative change and percentage', async () => {
      const mockPayload = [
        {
          日期: '1150903',
          指數: '發行量加權股價指數',
          收盤指數: '45,857.66',
          漲跌: '-',
          漲跌點數: '120.50',
          漲跌百分比: '-0.26',
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockPayload), { status: 200 }),
      );

      const result = await Effect.runPromise(Effect.either(provider.getTaiex()));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right).toEqual({
          asOf: '2026-09-03',
          close: 45857.66,
          change: -120.5,
          changePercent: -0.26,
        });
      }
    });
  });

  describe('InstitutionalFlow', () => {
    it('normalizes dealer = proprietary + hedge, does not double count foreign dealer, takes total from official 合計', async () => {
      const mockPayload = {
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

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockPayload), { status: 200 }),
      );

      const result = await Effect.runPromise(Effect.either(provider.getInstitutionalFlow()));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right).toEqual({
          asOf: '2026-09-04',
          market: 'TWSE',
          foreignNetAmount: 56212953803,
          investmentTrustNetAmount: -910866463,
          dealerNetAmount: 1506303813 + 4863757431, // 6370061244
          totalNetAmount: 61672148584,
        });
      }
    });
  });
});
