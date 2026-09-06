import { expect, test } from '@playwright/test';

const MOCK_MARKET_OVERVIEW = {
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

const QUOTE_2330 = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 2410,
  previousClose: 2390,
  change: 20,
  changePercent: 0.84,
  tradeDate: '2026-09-04',
  openPrice: 2395,
  highPrice: 2415,
  lowPrice: 2390,
  tradeVolume: 22334455,
  limitUpPrice: 2629,
  limitDownPrice: 2151,
  tradeVolumeUnit: 'lot',
  source: {
    provider: 'fugle',
    fallbackUsed: false,
    fetchedAt: '2026-09-06T03:45:06.000Z',
    asOf: '2026-09-04T05:30:00.000Z',
    cacheHit: false,
  },
};

const CANDLES_2330 = {
  symbol: '2330',
  market: 'TWSE',
  range: '1d',
  timeframe: '5m',
  volumeUnit: 'lot',
  candles: [
    { date: '2026-09-04T09:00:00.000+08:00', open: 2300, high: 2320, low: 2280, close: 2310, volume: 850, ma5: null, ma10: null, ma20: null, ma60: null },
    { date: '2026-09-04T09:05:00.000+08:00', open: 2310, high: 2330, low: 2300, close: 2320, volume: 900, ma5: 2315, ma10: null, ma20: null, ma60: null },
  ],
};

test.use({ viewport: { width: 390, height: 844 } });

test('mobile viewport smoke: usable search, market overview, watchlist, and chart', async ({ page }) => {
  await page.route('**/api/v1/market/overview', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MARKET_OVERVIEW) });
  });
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUOTE_2330) });
  });
  await page.route('**/api/v1/stocks/2330/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CANDLES_2330) });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      'tw-stock-dashboard.watchlist.v1',
      JSON.stringify([{ symbol: '2330', name: '台積電' }]),
    );
  });

  await page.goto('/');

  // Header and status badge
  await expect(page.getByRole('heading', { name: 'Taiwan Stock Dashboard' })).toBeVisible();
  await expect(page.getByLabel('API 連線狀態')).toBeVisible();
  await expect(page.getByRole('heading', { name: '台股市場焦點' })).toBeVisible();

  // Market overview cards readable
  await expect(page.getByTestId('market-index-加權指數 (TAIEX)')).toBeVisible();
  await expect(page.getByTestId('market-index-櫃買指數 (OTC)')).toBeVisible();
  await expect(page.getByTestId('market-institutional')).toBeVisible();
  await expect(page.getByText('自選觀察清單')).toBeVisible();

  // Watchlist reachable and usable
  const watchItem = page.getByTestId('watchlist-item-2330');
  await expect(watchItem).toBeVisible();
  await watchItem.click();

  // Quote and chart load properly
  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');
  await expect(page.getByTestId('stock-quote-price')).toHaveText('2410');
  await expect(page.getByTestId('stock-quote-change')).toHaveText('較前一交易日 上漲 20 (+0.84%)');
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();
  await expect(page.getByTestId('recent-trading-table')).toBeVisible();

  // Mobile order: focus quote, chart, table, then watchlist.
  const order = await page.evaluate(() => {
    const quote = document.querySelector('[data-testid="stock-quote-info"]');
    const chart = document.querySelector('[data-testid="stock-history-chart"]');
    const table = document.querySelector('[data-testid="recent-trading-table"]');
    const watchlist = document.querySelector('[aria-label="自選股清單"]');
    if (!quote || !chart || !table || !watchlist) return 'missing';
    const following = (a: Element, b: Element): boolean =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return following(quote, chart) && following(chart, table) && following(table, watchlist)
      ? 'ordered'
      : 'unordered';
  });
  expect(order).toBe('ordered');
});
