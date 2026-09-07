import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStockQuoteBatch } from './stock-quote.api.js';

const BATCH_RESPONSE = {
  items: [
    {
      symbol: '2330',
      quote: {
        symbol: '2330',
        name: '台積電',
        market: 'TWSE',
        price: 568,
        referencePrice: 566,
        referencePriceType: 'previous_close',
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
        source: {
          provider: 'twse-mis',
          fallbackUsed: true,
          fallbackReason: 'config_missing',
          fetchedAt: '2026-09-07T01:00:00.000Z',
          asOf: null,
          cacheHit: false,
        },
      },
      error: null,
    },
    { symbol: '999999', quote: null, error: 'not_found' },
  ],
};

describe('fetchStockQuoteBatch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses one request and preserves successful and failed symbols', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(JSON.stringify(BATCH_RESPONSE), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStockQuoteBatch(['2330', '999999']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/stocks/quotes?symbols=2330%2C999999');
    expect(result.items[0]?.quote?.price).toBe(568);
    expect(result.items[1]).toEqual({ symbol: '999999', quote: null, error: 'not_found' });
  });
});
