import { Effect, Either } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TpexEsbQuoteProvider } from './tpex-esb-quote.provider.js';

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

function okOnce(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

function run(symbol = '7883') {
  return Effect.runPromise(Effect.either(new TpexEsbQuoteProvider().getQuote(symbol)));
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
