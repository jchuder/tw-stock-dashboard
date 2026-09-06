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

// 22 trading days of realistic TSMC price action
const CANDLES_2330 = {
  symbol: '2330',
  market: 'TWSE',
  range: '1m',
  candles: [
    { date: '2026-08-05', open: 2280, high: 2310, low: 2270, close: 2300, volume: 24500000, ma5: null, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-06', open: 2305, high: 2325, low: 2295, close: 2315, volume: 26800000, ma5: null, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-07', open: 2320, high: 2340, low: 2310, close: 2335, volume: 31200000, ma5: null, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-10', open: 2330, high: 2350, low: 2320, close: 2340, volume: 28900000, ma5: null, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-11', open: 2345, high: 2360, low: 2330, close: 2350, volume: 29500000, ma5: 2328, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-12', open: 2350, high: 2355, low: 2330, close: 2335, volume: 22400000, ma5: 2335, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-13', open: 2340, high: 2370, low: 2335, close: 2365, volume: 33100000, ma5: 2345, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-14', open: 2370, high: 2385, low: 2360, close: 2375, volume: 30400000, ma5: 2353, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-17', open: 2380, high: 2390, low: 2365, close: 2370, volume: 25100000, ma5: 2359, ma10: null, ma20: null, ma60: null },
    { date: '2026-08-18', open: 2375, high: 2400, low: 2370, close: 2395, volume: 34800000, ma5: 2368, ma10: 2348, ma20: null, ma60: null },
    { date: '2026-08-19', open: 2390, high: 2405, low: 2380, close: 2385, volume: 27600000, ma5: 2378, ma10: 2356, ma20: null, ma60: null },
    { date: '2026-08-20', open: 2380, high: 2390, low: 2360, close: 2365, volume: 26300000, ma5: 2378, ma10: 2361, ma20: null, ma60: null },
    { date: '2026-08-21', open: 2370, high: 2385, low: 2365, close: 2380, volume: 23900000, ma5: 2379, ma10: 2366, ma20: null, ma60: null },
    { date: '2026-08-24', open: 2390, high: 2410, low: 2385, close: 2405, volume: 35200000, ma5: 2386, ma10: 2372, ma20: null, ma60: null },
    { date: '2026-08-25', open: 2410, high: 2425, low: 2395, close: 2415, volume: 36700000, ma5: 2390, ma10: 2379, ma20: null, ma60: null },
    { date: '2026-08-26', open: 2415, high: 2430, low: 2400, close: 2405, volume: 29100000, ma5: 2394, ma10: 2386, ma20: null, ma60: null },
    { date: '2026-08-27', open: 2400, high: 2410, low: 2380, close: 2390, volume: 27400000, ma5: 2399, ma10: 2388, ma20: null, ma60: null },
    { date: '2026-08-28', open: 2395, high: 2415, low: 2390, close: 2400, volume: 28300000, ma5: 2403, ma10: 2391, ma20: null, ma60: null },
    { date: '2026-08-31', open: 2405, high: 2420, low: 2395, close: 2410, volume: 30900000, ma5: 2404, ma10: 2395, ma20: null, ma60: null },
    { date: '2026-09-01', open: 2415, high: 2435, low: 2410, close: 2425, volume: 33400000, ma5: 2406, ma10: 2398, ma20: 2373, ma60: null },
    { date: '2026-09-02', open: 2420, high: 2425, low: 2385, close: 2390, volume: 32100000, ma5: 2403, ma10: 2398, ma20: 2377, ma60: null },
    { date: '2026-09-03', open: 2395, high: 2405, low: 2375, close: 2390, volume: 29800000, ma5: 2403, ma10: 2401, ma20: 2381, ma60: null },
    { date: '2026-09-04', open: 2400, high: 2420, low: 2390, close: 2410, volume: 38500000, ma5: 2405, ma10: 2404, ma20: 2384, ma60: null },
  ],
};

const WATCHLIST_ITEMS = [
  { symbol: '2330', name: '台積電' },
  { symbol: '2317', name: '鴻海' },
  { symbol: '2454', name: '聯發科' },
  { symbol: '2603', name: '長榮' },
  { symbol: '0050', name: '元大台灣50' },
];

test.use({ viewport: { width: 1440, height: 1000 } });

test('capture dashboard screenshot for documentation', async ({ page }) => {
  await page.route('**/api/v1/market/overview', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MARKET_OVERVIEW) }),
  );
  await page.route('**/api/v1/stocks/2330/quote', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUOTE_2330) }),
  );
  await page.route('**/api/v1/stocks/2330/history*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CANDLES_2330) }),
  );

  await page.addInitScript((items) => {
    localStorage.setItem('tw-stock-dashboard.watchlist.v1', JSON.stringify(items));
  }, WATCHLIST_ITEMS);

  await page.goto('/');

  // Select 2330 from watchlist
  const item2330 = page.getByTestId('watchlist-item-2330');
  await expect(item2330).toBeVisible();
  await item2330.click();

  // Wait for quote, chart, and recent table to settle
  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');
  await expect(page.getByTestId('stock-quote-price')).toHaveText('2410');
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();

  // Wait 500ms for lightweight-charts rendering canvas to complete animation/layout
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'docs/dashboard.png', fullPage: false });
});
