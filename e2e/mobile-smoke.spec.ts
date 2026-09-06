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
  range: '1m',
  candles: [
    { date: '2026-08-05', open: 2300, high: 2320, low: 2280, close: 2310, volume: 28765432, ma5: null, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-06', open: 2310, high: 2330, low: 2300, close: 2320, volume: 30123456, ma5: 2315, ma10: null, ma20: null, ma60: null },
  ],
};

test.use({ viewport: { width: 390, height: 844 } });

test('mobile viewport smoke: usable search, market overview, watchlist, and chart', async ({ page }) => {
  await page.route('**/api/v1/market/overview', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MARKET_OVERVIEW) }),
  );
  await page.route('**/api/v1/stocks/2330/quote', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUOTE_2330) }),
  );
  await page.route('**/api/v1/stocks/2330/history*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CANDLES_2330) }),
  );

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

  // Market overview cards readable
  await expect(page.getByTestId('market-index-加權指數')).toBeVisible();
  await expect(page.getByTestId('market-index-櫃買指數')).toBeVisible();
  await expect(page.getByTestId('market-institutional')).toBeVisible();

  // Watchlist reachable and usable
  const watchItem = page.getByTestId('watchlist-item-2330');
  await expect(watchItem).toBeVisible();
  await watchItem.click();

  // Quote and chart load properly
  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');
  await expect(page.getByTestId('stock-quote-price')).toHaveText('2410');
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();
});
