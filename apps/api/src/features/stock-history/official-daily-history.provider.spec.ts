import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { OfficialDailyHistoryProvider } from './official-daily-history.provider.js';

describe('OfficialDailyHistoryProvider', () => {
  const provider = new OfficialDailyHistoryProvider();

  it('correctly resolves TWSE stock and parses daily rows', async () => {
    const twseData = {
      stat: 'OK',
      data: [
        ['115/08/05', '10,000,000', '1,000,000', '1,000.00', '1,050.00', '990.00', '1,040.00', '+40.00', '1,000'],
        ['115/08/06', '12,000,000', '1,200,000', '1,040.00', '1,060.00', '1,030.00', '1,050.00', '+10.00', '1,200'],
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('twse.com.tw')) {
          return new Response(JSON.stringify(twseData), { status: 200 });
        }
        return new Response(JSON.stringify({ stat: 'No Data' }), { status: 200 });
      }),
    );

    const result = await Effect.runPromise(
      provider.getDailyHistory('2330', '2026-08-01', '2026-08-06'),
    );

    expect(result.symbol).toBe('2330');
    expect(result.market).toBe('TWSE');
    expect(result.provider).toBe('twse');
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0]).toEqual({
      date: '2026-08-05',
      open: 1000,
      high: 1050,
      low: 990,
      close: 1040,
      volume: 10000000,
    });
  });

  it('correctly resolves TPEx stock and converts thousand-shares (仟股) volume to shares (* 1000)', async () => {
    const tpexData = {
      stat: 'ok',
      tables: [
        {
          data: [
            ['115/08/05', '1,500', '150,000', '100.00', '105.00', '98.00', '102.00', '+2.00', '500'],
            ['115/08/06', '2,000', '200,000', '102.00', '104.00', '101.00', '103.00', '+1.00', '600'],
          ],
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('tpex.org.tw')) {
          return new Response(JSON.stringify(tpexData), { status: 200 });
        }
        return new Response(JSON.stringify({ stat: '查詢無資料' }), { status: 200 });
      }),
    );

    const result = await Effect.runPromise(
      provider.getDailyHistory('6488', '2026-08-01', '2026-08-06'),
    );

    expect(result.symbol).toBe('6488');
    expect(result.market).toBe('TPEX');
    expect(result.provider).toBe('tpex');
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0].volume).toBe(1500000);
    expect(result.candles[1].volume).toBe(2000000);
  });

  it('resolves market when latest month has no data but prior month has data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('tpex.org.tw')) {
          if (url.includes('date=2026%2F09%2F01')) {
            return new Response(JSON.stringify({ stat: 'ok', tables: [{ data: [] }] }), { status: 200 });
          }
          if (url.includes('date=2026%2F08%2F01')) {
            return new Response(
              JSON.stringify({
                stat: 'ok',
                tables: [
                  {
                    data: [
                      ['115/08/28', '500', '50,000', '100.00', '102.00', '99.00', '101.00', '+1.00', '200'],
                    ],
                  },
                ],
              }),
              { status: 200 },
            );
          }
        }
        return new Response(JSON.stringify({ stat: 'No Data' }), { status: 200 });
      }),
    );

    const result = await Effect.runPromise(
      provider.getDailyHistory('6488', '2026-08-01', '2026-09-02'),
    );

    expect(result.market).toBe('TPEX');
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].date).toBe('2026-08-28');
  });

  it('fails with OfficialDailyHistoryError when TPEx returns HTTP 500 without silently masking outage as empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('tpex.org.tw')) {
          return new Response('Internal Server Error', { status: 500 });
        }
        return new Response(JSON.stringify({ stat: 'No Data' }), { status: 200 });
      }),
    );

    const either = await Effect.runPromise(
      Effect.either(provider.getDailyHistory('6488', '2026-08-01', '2026-08-06')),
    );

    expect(either._tag).toBe('Left');
    if (either._tag === 'Left') {
      expect(either.left._tag).toBe('OfficialDailyHistoryError');
    }
  });

  it('fails with StockHistoryNotFoundError when symbol does not exist on either TWSE or TPEx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ stat: 'No Data', tables: [{ data: [] }] }), { status: 200 });
      }),
    );

    const either = await Effect.runPromise(
      Effect.either(provider.getDailyHistory('0000', '2026-08-01', '2026-08-06')),
    );

    expect(either._tag).toBe('Left');
    if (either._tag === 'Left') {
      expect(either.left._tag).toBe('StockHistoryNotFoundError');
    }
  });
});
