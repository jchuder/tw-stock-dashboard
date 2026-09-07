import { Effect, Either } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../../libs/cache/cache.service.js';
import { OfficialDailyQuoteProvider } from './official-daily-quote.provider.js';

const TWSE_ROW = {
  Date: '1150904',
  Code: '2330',
  Name: '台積電',
  TradeVolume: '14102018',
  OpeningPrice: '2415.00',
  HighestPrice: '2415.00',
  LowestPrice: '2390.00',
  ClosingPrice: '2410.00',
  Change: '20.0000',
};

const TPEX_ROW = {
  Date: '1150907',
  SecuritiesCompanyCode: '006201',
  CompanyName: '元大富櫃50',
  TradingShares: '137950',
  Open: '44.98',
  High: '45.82',
  Low: '44.98',
  Close: '45.41',
  Change: '+1.23',
};

type TestCache = Pick<CacheService, 'getJson' | 'setJson' | 'del'>;

function makeCache(initial: Record<string, unknown> = {}): TestCache {
  const values = new Map(Object.entries(initial));
  return {
    getJson: (key) => Effect.succeed(values.get(key) ?? null),
    setJson: (key, value) => Effect.sync(() => void values.set(key, value)),
    del: (key) => Effect.sync(() => void values.delete(key)),
  };
}

function run(
  symbol: string,
  market: 'TWSE' | 'TPEX',
  cache = makeCache(),
): Promise<Either.Either<{ quote: unknown; asOf: string | null }, unknown>> {
  return Effect.runPromise(Effect.either(new OfficialDailyQuoteProvider(cache).getQuote(symbol, market)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OfficialDailyQuoteProvider', () => {
  it('normalizes a TWSE daily snapshot to a lot-based quote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([TWSE_ROW]))));

    const result = await run('2330', 'TWSE');

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        quote: {
          symbol: '2330',
          name: '台積電',
          market: 'TWSE',
          price: 2410,
          referencePrice: 2390,
          referencePriceType: 'previous_close',
          change: 20,
          changePercent: 0.84,
          tradeDate: '2026-09-04',
          openPrice: 2415,
          highPrice: 2415,
          lowPrice: 2390,
          tradeVolume: 14102.018,
          tradeVolumeUnit: 'lot',
          limitUpPrice: null,
          limitDownPrice: null,
        },
        asOf: null,
      });
    }
  });

  it('normalizes a TPEx daily snapshot to a lot-based quote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([TPEX_ROW]))));

    const result = await run('006201', 'TPEX');

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toEqual({
        quote: {
          symbol: '006201',
          name: '元大富櫃50',
          market: 'TPEX',
          price: 45.41,
          referencePrice: 44.18,
          referencePriceType: 'previous_close',
          change: 1.23,
          changePercent: 2.78,
          tradeDate: '2026-09-07',
          openPrice: 44.98,
          highPrice: 45.82,
          lowPrice: 44.98,
          tradeVolume: 137.95,
          tradeVolumeUnit: 'lot',
          limitUpPrice: null,
          limitDownPrice: null,
        },
        asOf: null,
      });
    }
  });

  it('fails with a typed value error when the daily snapshot has no symbol', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([TWSE_ROW]))));

    const result = await run('2454', 'TWSE');

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: 'OfficialDailyQuoteError', market: 'TWSE', stage: 'value' });
    }
  });
});
