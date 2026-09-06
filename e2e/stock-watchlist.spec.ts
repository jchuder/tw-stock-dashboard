import { expect, test } from '@playwright/test';

const QUOTE_2330 = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
  source: {
    provider: 'fugle',
    fallbackUsed: false,
    fetchedAt: '2026-09-05T04:40:00.000Z',
    asOf: null,
    cacheHit: false,
  },
};

const QUOTE_2454 = {
  symbol: '2454',
  name: '聯發科',
  market: 'TWSE',
  price: 1200,
  previousClose: 1180,
  change: 20,
  changePercent: 1.69,
  source: {
    provider: 'fugle',
    fallbackUsed: false,
    fetchedAt: '2026-09-05T04:40:00.000Z',
    asOf: null,
    cacheHit: false,
  },
};

function makeCandles(symbol: string) {
  return {
    symbol,
    market: 'TWSE',
    range: '1m',
    candles: [
      {
        date: '2026-08-05',
        open: 550,
        high: 560,
        low: 540,
        close: 555,
        volume: 1000,
        ma5: null,
        ma10: null,
        ma20: null,
        ma60: null,
      },
      {
        date: '2026-08-06',
        open: 555,
        high: 568,
        low: 550,
        close: 568,
        volume: 2000,
        ma5: 555,
        ma10: null,
        ma20: null,
        ma60: null,
      },
    ],
  };
}

test('A & B: Add to watchlist and duplicate protection', async ({ page }) => {
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUOTE_2330) });
  });
  await page.route('**/api/v1/stocks/2330/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeCandles('2330')) });
  });

  await page.goto('/');

  // Search 2330
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();

  // Add button appears and can be clicked
  const addBtn = page.getByRole('button', { name: '加入自選' });
  await expect(addBtn).toBeVisible();
  await addBtn.click();

  // Item appears in watchlist
  const watchItem = page.getByTestId('watchlist-item-2330');
  await expect(watchItem).toBeVisible();
  await expect(watchItem).toContainText('2330 台積電');

  // Button turns into 已在自選 and is disabled
  await expect(page.getByRole('button', { name: '已在自選' })).toBeDisabled();

  // LocalStorage check
  const storageContent = await page.evaluate(() =>
    localStorage.getItem('tw-stock-dashboard.watchlist.v1'),
  );
  expect(JSON.parse(storageContent!)).toEqual([{ symbol: '2330', name: '台積電' }]);
});

test('C: Persistence and No quote fan-out on reload', async ({ page }) => {
  let quoteCount = 0;
  let historyCount = 0;

  await page.route('**/api/v1/stocks/*/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    quoteCount++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUOTE_2330) });
  });
  await page.route('**/api/v1/stocks/*/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    historyCount++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeCandles('2330')) });
  });

  // Prepopulate localStorage with 5 items
  await page.addInitScript(() => {
    localStorage.setItem(
      'tw-stock-dashboard.watchlist.v1',
      JSON.stringify([
        { symbol: '2330', name: '台積電' },
        { symbol: '2454', name: '聯發科' },
        { symbol: '2308', name: '台達電' },
        { symbol: '2317', name: '鴻海' },
        { symbol: '2382', name: '廣達' },
      ]),
    );
  });

  await page.goto('/');

  // Watchlist items are visible
  await expect(page.getByTestId('watchlist-item-2330')).toBeVisible();
  await expect(page.getByTestId('watchlist-item-2454')).toBeVisible();

  // Ensure no quote or history request is made on reload
  await page.waitForTimeout(500);
  expect(quoteCount).toBe(0);
  expect(historyCount).toBe(0);
});

test('D: Focus switching between watchlist items', async ({ page }) => {
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUOTE_2330) });
  });
  await page.route('**/api/v1/stocks/2330/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeCandles('2330')) });
  });
  await page.route('**/api/v1/stocks/2454/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUOTE_2454) });
  });
  await page.route('**/api/v1/stocks/2454/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeCandles('2454')) });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      'tw-stock-dashboard.watchlist.v1',
      JSON.stringify([
        { symbol: '2330', name: '台積電' },
        { symbol: '2454', name: '聯發科' },
      ]),
    );
  });

  await page.goto('/');

  // Focus 2330
  await page.getByTestId('watchlist-item-2330').click();
  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');
  await expect(page.getByTestId('stock-quote-price')).toHaveText('568');

  // Click 2454
  await page.getByTestId('watchlist-item-2454').click();
  await expect(page.getByTestId('stock-quote-title')).toHaveText('2454 聯發科');
  await expect(page.getByTestId('watchlist-item-2454')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('watchlist-item-2330')).not.toHaveAttribute('aria-current', 'true');
});

test('E: Remove active stock keeps quote and chart displayed', async ({ page }) => {
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUOTE_2330) });
  });
  await page.route('**/api/v1/stocks/2330/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeCandles('2330')) });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      'tw-stock-dashboard.watchlist.v1',
      JSON.stringify([{ symbol: '2330', name: '台積電' }]),
    );
  });

  await page.goto('/');

  // Focus 2330
  await page.getByTestId('watchlist-item-2330').click();
  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');

  // Click 移除
  await page.getByRole('button', { name: '移除 2330' }).click();

  // Watchlist item is removed
  await expect(page.getByTestId('watchlist-item-2330')).toHaveCount(0);

  // Quote and chart remain displayed
  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');
  await expect(page.getByTestId('stock-quote-price')).toHaveText('568');
});

test('F: >4 items list is scrollable and all items reachable', async ({ page }) => {
  const items = [
    { symbol: '2330', name: '台積電' },
    { symbol: '2454', name: '聯發科' },
    { symbol: '2308', name: '台達電' },
    { symbol: '2317', name: '鴻海' },
    { symbol: '2382', name: '廣達' },
    { symbol: '3008', name: '大立光' },
  ];

  await page.addInitScript((data) => {
    localStorage.setItem('tw-stock-dashboard.watchlist.v1', JSON.stringify(data));
  }, items);

  await page.goto('/');

  const container = page.getByTestId('watchlist-container');
  await expect(container).toBeVisible();

  // Verify container is scrollable
  const isScrollable = await container.evaluate(
    (el) => el.scrollHeight > el.clientHeight,
  );
  expect(isScrollable).toBe(true);

  // 6th item exists and can be scrolled into view
  const lastItem = page.getByTestId('watchlist-item-3008');
  await lastItem.scrollIntoViewIfNeeded();
  await expect(lastItem).toBeVisible();
});

test('G: Invalid symbol cannot be added to watchlist', async ({ page }) => {
  await page.route('**/api/v1/stocks/999999/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 404, message: 'Stock not found', error: 'Not Found' }),
    });
  });

  await page.goto('/');

  await page.getByPlaceholder('2330').fill('999999');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('查無此股票代號')).toBeVisible();
  await expect(page.getByRole('button', { name: '加入自選' })).toHaveCount(0);
});
