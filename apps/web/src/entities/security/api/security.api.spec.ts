import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSecurities } from './security.api.js';

describe('fetchSecurities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and decodes dynamic name and market metadata in one request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).searchParams.get('symbols')).toBe('2330,7883');
      return new Response(
        JSON.stringify([
          { symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' },
          { symbol: '7883', name: '鑫科', market: 'TPEX', type: 'stock' },
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSecurities(['2330', '7883'])).resolves.toEqual([
      { symbol: '2330', name: '台積電', market: 'TWSE', type: 'stock' },
      { symbol: '7883', name: '鑫科', market: 'TPEX', type: 'stock' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
