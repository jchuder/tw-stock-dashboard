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
      { date: '2026-08-05', open: 551, high: 561, low: 541, close: 555, volume: 1000 },
      { date: '2026-08-06', open: 555, high: 566, low: 545, close: price, volume: 2000 },
    ],
  };
}

async function setupAnalysis(page: Page) {
  const historyRanges: string[] = [];
  await page.route('**/api/v1/stocks/2330/quote', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(QUOTE_BODY),
    }),
  );
  await page.route('**/api/v1/stocks/2330/history*', (route) => {
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

test('search loads chart and recent table', async ({ page }) => {
  const historyRanges = await setupAnalysis(page);

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('2330 台積電')).toBeVisible();
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();
  await expect(page.getByText('TradingView Lightweight Charts™')).toBeVisible();
  await expect(page.getByText('開盤')).toBeVisible();
  await expect(page.getByText('2026-08-06')).toBeVisible();
  expect(historyRanges).toContain('1m');
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
  await page.route('**/api/v1/stocks/2330/quote', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(QUOTE_BODY),
    }),
  );
  await page.route('**/api/v1/stocks/2330/history*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('2330 台積電')).toBeVisible();
  await expect(page.getByText('歷史資料載入失敗，請稍後再試')).toBeVisible();
});
