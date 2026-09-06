import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '../../../shared/api/base-url.js';
import { fetchMarketOverview } from './market-overview.api.js';

vi.mock('../../../shared/api/base-url.js', () => ({
  API_BASE_URL: 'http://api.test:9999',
}));

const MOCK_OVERVIEW = {
  taiex: { asOf: '2026-09-04', close: 46551.13, change: 693.47, changePercent: 1.51 },
  otc: { asOf: '2026-09-04', close: 402.48, change: 7.23, changePercent: 1.83 },
  institutional: {
    asOf: '2026-09-04',
    market: 'TWSE' as const,
    foreignNetAmount: 56212953803,
    investmentTrustNetAmount: -910866463,
    dealerNetAmount: 6370061244,
    totalNetAmount: 61672148584,
  },
};

describe('fetchMarketOverview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests market overview through shared API_BASE_URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_OVERVIEW), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMarketOverview();

    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/api/v1/market/overview`);
    expect(result).toEqual(MOCK_OVERVIEW);
  });

  it('throws an error when upstream returns non-200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMarketOverview()).rejects.toThrow('Failed to fetch market overview: 500');
  });
});
