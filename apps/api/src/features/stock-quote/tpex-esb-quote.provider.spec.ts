import { Effect, Either } from 'effect';
import type { CacheService } from '../../libs/cache/cache.service.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ESB_SNAPSHOT_CACHE_KEY, ESB_SNAPSHOT_CACHE_TTL_SECONDS, TpexEsbQuoteProvider } from './tpex-esb-quote.provider.js';

const ROW_7883 = {
  Date: '1150907',
  Time: '160006',
  SecuritiesCompanyCode: '7883',
  CompanyName: '饗賓',
  PreviousAveragePrice: '280',
  BuyingPrice: '282.5',
  BuyingQuantity: '3000',
  SellingPrice: '290.5',
  SellingQuantity: '4999',
  Highest: '293',
  Lowest: '281.5',
  Average: '283.72',
  LatestPrice: '290',
  'Buy/Sell': 'B',
  SuspendTime: '000000',
  TransactionVolume: '66789',
  ApplyingDate: '20260904',
  ApplyingStatus: 'b',
};

const EXPECTED_QUOTE = {
  symbol: '7883',
  name: '饗賓',
  market: 'ESB',
  price: 290,
  referencePrice: 280,
  referencePriceType: 'previous_average',
  change: 10,
  changePercent: 3.57,
  tradeDate: '2026-09-07',
  openPrice: null,
  highPrice: 293,
  lowPrice: 281.5,
  tradeVolume: 66789,
  tradeVolumeUnit: 'share',
  limitUpPrice: null,
  limitDownPrice: null,
};

type TestCache = Pick<CacheService, 'getJson' | 'setJson' | 'del'>;

function makeCache(initial: Record<string, unknown> = {}): TestCache {
  const values = new Map(Object.entries(initial));
  return {
    getJson: vi.fn((key: string) => Effect.succeed(values.get(key) ?? null)),
    setJson: vi.fn((key: string, value: unknown) => {
      values.set(key, value);
      return Effect.succeed(undefined);
    }),
    del: vi.fn(() => Effect.succeed(undefined)),
  };
}

function cachedProvider(cache = makeCache()): TpexEsbQuoteProvider {
  return new TpexEsbQuoteProvider(cache);
}

function run(symbol = '7883', cache = makeCache()) {
  return Effect.runPromise(Effect.either(cachedProvider(cache).getQuote(symbol)));
}

function okOnce(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

describe('TpexEsbQuoteProvider typed failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes an ESB snapshot row with average-based reference', async () => {
    okOnce([ROW_7883]);

    const result = await run();

    expect(result).toEqual(Either.right({ quote: EXPECTED_QUOTE, asOf: '2026-09-07T08:00:06.000Z' }));
  });

  it('degrades a missing previous average to null change without failing', async () => {
    okOnce([{ ...ROW_7883, PreviousAveragePrice: '00000.0000' }]);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.quote).toMatchObject({
        referencePrice: null,
        referencePriceType: 'previous_average',
        change: null,
        changePercent: null,
        price: 290,
      });
    }
  });

  it('reuses one full-market snapshot across symbols within the shared TTL', async () => {
    const cache = makeCache();
    const row1260 = { ...ROW_7883, SecuritiesCompanyCode: '1260', CompanyName: '富味鄉' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([ROW_7883, row1260]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = cachedProvider(cache);

    const first = await Effect.runPromise(Effect.either(provider.getQuote('7883')));
    const second = await Effect.runPromise(Effect.either(provider.getQuote('1260')));

    expect(Either.isRight(first)).toBe(true);
    expect(Either.isRight(second)).toBe(true);
    if (Either.isRight(first) && Either.isRight(second)) {
      expect(first.right.quote.symbol).toBe('7883');
      expect(second.right.quote.symbol).toBe('1260');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.getJson).toHaveBeenCalledTimes(2);
    expect(cache.setJson).toHaveBeenCalledWith(
      ESB_SNAPSHOT_CACHE_KEY,
      expect.arrayContaining([
        expect.objectContaining({ SecuritiesCompanyCode: '7883' }),
        expect.objectContaining({ SecuritiesCompanyCode: '1260' }),
      ]),
      ESB_SNAPSHOT_CACHE_TTL_SECONDS,
    );
  });

  it('refreshes and replaces an invalid cached snapshot', async () => {
    const cache = makeCache({ [ESB_SNAPSHOT_CACHE_KEY]: { invalid: true } });
    okOnce([ROW_7883]);

    const result = await run('7883', cache);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.quote.symbol).toBe('7883');
    }
    expect(cache.del).toHaveBeenCalledWith(ESB_SNAPSHOT_CACHE_KEY);
    expect(cache.setJson).toHaveBeenCalledWith(
      ESB_SNAPSHOT_CACHE_KEY,
      [expect.objectContaining({ SecuritiesCompanyCode: '7883' })],
      ESB_SNAPSHOT_CACHE_TTL_SECONDS,
    );
  });
  it('maps no-trade zero sentinels to null prices while preserving zero volume', async () => {
    okOnce([
      {
        ...ROW_7883,
        LatestPrice: '0',
        Highest: '0',
        Lowest: '0',
        TransactionVolume: '0',
        PreviousAveragePrice: '280',
      },
    ]);

    const result = await run();

    expect(result).toEqual(
      Either.right({
        quote: {
          ...EXPECTED_QUOTE,
          price: null,
          highPrice: null,
          lowPrice: null,
          tradeVolume: 0,
          change: null,
          changePercent: null,
        },
        asOf: '2026-09-07T08:00:06.000Z',
      }),
    );
  });

  it('keeps the quote but nulls trade date and asOf for invalid ROC date', async () => {
    okOnce([{ ...ROW_7883, Date: '1151399' }]);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.quote.tradeDate).toBeNull();
      expect(result.right.asOf).toBeNull();
    }
  });

  it('keeps the quote but nulls asOf for invalid snapshot time', async () => {
    okOnce([{ ...ROW_7883, Time: '999999' }]);

    const result = await run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.quote.tradeDate).toBe('2026-09-07');
      expect(result.right.asOf).toBeNull();
    }
  });

  it('fails value decode when the symbol is absent from the snapshot', async () => {
    okOnce([{ ...ROW_7883, SecuritiesCompanyCode: '1260', CompanyName: '富味鄉' }]);

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TpexEsbDecodeError');
    }
  });

  it('fails value decode when the latest price is missing', async () => {
    okOnce([{ ...ROW_7883, LatestPrice: '-' }]);

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TpexEsbDecodeError');
    }
  });

  it('fails HttpError on upstream non-2xx', async () => {
    okOnce({ message: 'boom' }, 500);

    const result = await run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('TpexEsbHttpError');
    }
  });
});
