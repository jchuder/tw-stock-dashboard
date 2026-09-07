import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStockQuoteBatch, fetchStockQuoteBatches } from './stock-quote.api.js';

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

  it('splits more than 20 symbols into bounded requests and merges results', async () => {
    const symbols = Array.from({ length: 21 }, (_, index) => String(1000 + index));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requestedSymbols = new URL(String(input)).searchParams.get('symbols')?.split(',') ?? [];
      return new Response(
        JSON.stringify({
          items: requestedSymbols.map((symbol) => ({ symbol, quote: null, error: 'failed' })),
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStockQuoteBatches(symbols);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('symbols')?.split(',')).toEqual(
      symbols.slice(0, 20),
    );
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('symbols')?.split(',')).toEqual(
      symbols.slice(20),
    );
    expect(result.items.map((item) => item.symbol)).toEqual(symbols);
  });

  it('keeps a successful sibling chunk when one chunk request fails', async () => {
    const symbols = Array.from({ length: 21 }, (_, index) => String(2000 + index));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requestedSymbols = new URL(String(input)).searchParams.get('symbols')?.split(',') ?? [];
      if (requestedSymbols.length === 20) {
        throw new Error('network failure');
      }
      return new Response(
        JSON.stringify({
          items: requestedSymbols.map((symbol) => ({ symbol, quote: null, error: 'not_found' })),
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStockQuoteBatches(symbols);

    expect(result.items.slice(0, 20).every((item) => item.error === 'failed')).toBe(true);
    expect(result.items[20]).toEqual({ symbol: symbols[20], quote: null, error: 'not_found' });
  });
});
