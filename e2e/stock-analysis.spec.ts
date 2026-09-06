import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const QUOTE_BODY = {
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

function historyBody(range: string, price: number) {
  return {
    symbol: '2330',
    market: 'TWSE',
    range,
    candles: [
      { date: '2026-08-05', open: 551, high: 561, low: 541, close: 555, volume: 1000, ma5: null, ma10: null, ma20: null, ma60: null },
      { date: '2026-08-06', open: 555, high: 566, low: 545, close: price, volume: 2000, ma5: 555, ma10: null, ma20: null, ma60: null },
    ],
  };
}

async function setupAnalysis(page: Page) {
  const historyRanges: string[] = [];
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(QUOTE_BODY),
    });
  });
  await page.route('**/api/v1/stocks/2330/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    const range = new URL(route.request().url()).searchParams.get('range') ?? '1m';
    historyRanges.push(range);
    const price = range === '1m' ? 568 : range === '3m' ? 560 : 550;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(historyBody(range, price)),
    });
  });
  return historyRanges;
}

test('search loads chart, MA toggles, and recent table', async ({ page }) => {
  const historyRanges = await setupAnalysis(page);

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('2330 台積電')).toBeVisible();
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();
  await expect(page.getByText('TradingView Lightweight Charts™')).toBeVisible();
  await expect(page.getByRole('button', { name: 'MA5' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'MA5' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'MA10' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'MA10' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'MA20' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'MA20' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'MA60' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'MA60' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('開盤')).toBeVisible();
  await expect(page.getByText('2026-08-06')).toBeVisible();
  expect(historyRanges).toContain('1m');
});

test('MA toggles switch aria-pressed without refetching and persist across range switch', async ({ page }) => {
  const historyRanges = await setupAnalysis(page);

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();

  const initialRequests = historyRanges.length;

  // Toggle MA20 off
  await page.getByRole('button', { name: 'MA20' }).click();
  await expect(page.getByRole('button', { name: 'MA20' })).toHaveAttribute('aria-pressed', 'false');
  expect(historyRanges.length).toBe(initialRequests);

  // Toggle MA20 back on
  await page.getByRole('button', { name: 'MA20' }).click();
  await expect(page.getByRole('button', { name: 'MA20' })).toHaveAttribute('aria-pressed', 'true');
  expect(historyRanges.length).toBe(initialRequests);

  // Toggle MA20 off again
  await page.getByRole('button', { name: 'MA20' }).click();
  await expect(page.getByRole('button', { name: 'MA20' })).toHaveAttribute('aria-pressed', 'false');

  // Switch to 3M range
  await page.getByRole('button', { name: '3M' }).click();
  await expect(page.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
  expect(historyRanges.length).toBe(initialRequests + 1);
  expect(historyRanges[historyRanges.length - 1]).toBe('3m');

  // MA20 must preserve its toggled-off state
  await expect(page.getByRole('button', { name: 'MA20' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'MA5' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'MA10' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'MA60' })).toHaveAttribute('aria-pressed', 'true');
});

test('range buttons refetch with 3m and 6m', async ({ page }) => {
  await setupAnalysis(page);

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();

  await page.getByRole('button', { name: '3M' }).click();
  await expect(page.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('560')).toBeVisible();

  await page.getByRole('button', { name: '6M' }).click();
  await expect(page.getByRole('button', { name: '6M' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('550')).toBeVisible();
});

test('history failure does not take down the quote', async ({ page }) => {
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(QUOTE_BODY),
    });
  });
  await page.route('**/api/v1/stocks/2330/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('2330 台積電')).toBeVisible();
  await expect(page.getByText('歷史資料載入失敗，請稍後再試')).toBeVisible();
});

test('invalid symbol displays 查無此股票代號 without requesting history and without chart', async ({ page }) => {
  const historyCalls: string[] = [];
  await page.route('**/api/v1/stocks/999999/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 404, message: 'Stock not found', error: 'Not Found' }),
    });
  });
  await page.route('**/api/v1/stocks/**/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    historyCalls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('999999');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('查無此股票代號')).toBeVisible();
  await expect(page.getByTestId('stock-history-chart')).not.toBeVisible();
  expect(historyCalls.length).toBe(0);
});

test('quote upstream 500 displays 查詢失敗，請稍後再試 without requesting history', async ({ page }) => {
  const historyCalls: string[] = [];
  await page.route('**/api/v1/stocks/999999/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }),
    });
  });
  await page.route('**/api/v1/stocks/**/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    historyCalls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('999999');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('查詢失敗，請稍後再試')).toBeVisible();
  await expect(page.getByTestId('stock-history-chart')).not.toBeVisible();
  expect(historyCalls.length).toBe(0);
});

test('switching from valid stock to invalid stock removes old chart and displays 404', async ({ page }) => {
  const invalidHistoryCalls: string[] = [];
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(QUOTE_BODY),
    });
  });
  await page.route('**/api/v1/stocks/2330/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(historyBody('1m', 568)),
    });
  });
  await page.route('**/api/v1/stocks/999999/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 404, message: 'Stock not found', error: 'Not Found' }),
    });
  });
  await page.route('**/api/v1/stocks/999999/history*', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    invalidHistoryCalls.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('2330 台積電')).toBeVisible();
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();

  // Switch to invalid symbol
  await page.getByPlaceholder('2330').fill('999999');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('查無此股票代號')).toBeVisible();
  await expect(page.getByTestId('stock-history-chart')).not.toBeVisible();
  expect(invalidHistoryCalls.length).toBe(0);
});

