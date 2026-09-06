import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ENRICHED_QUOTE = {
  tradeDate: '2026-09-04',
  openPrice: 560,
  highPrice: 570,
  lowPrice: 559,
  tradeVolume: 12345678,
  limitUpPrice: 622,
  limitDownPrice: 510,
  tradeVolumeUnit: 'lot',
};

const QUOTE_BODY = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
  ...ENRICHED_QUOTE,
  source: {
    provider: 'fugle',
    fallbackUsed: false,
    fetchedAt: '2026-09-06T03:45:06.000Z',
    asOf: '2026-09-04T05:30:00.000Z',
    cacheHit: false,
  },
};

const INTRADAY_RANGES = new Set(['1d', '3d', '5d']);

function historyBody(range: string, price: number) {
  const intraday = INTRADAY_RANGES.has(range);
  return {
    symbol: '2330',
    market: 'TWSE',
    range,
    timeframe: intraday ? '5m' : '1d',
    volumeUnit: intraday ? 'lot' : 'share',
    candles: intraday
      ? [
          { date: '2026-09-04T09:00:00.000+08:00', open: 551, high: 561, low: 541, close: 555, volume: 850, ma5: null, ma10: null, ma20: null, ma60: null },
          { date: '2026-09-04T09:05:00.000+08:00', open: 555, high: 566, low: 545, close: price, volume: 900, ma5: 555, ma10: null, ma20: null, ma60: null },
        ]
      : [
          { date: '2026-08-05', open: 551, high: 561, low: 541, close: 555, volume: 1000, ma5: null, ma10: null, ma20: null, ma60: null },
          { date: '2026-08-06', open: 555, high: 566, low: 545, close: price, volume: 2000, ma5: 555, ma10: null, ma20: null, ma60: null },
        ],
  };
}

async function search(page: Page, symbol: string) {
  await page.getByPlaceholder('請輸入股票代號').fill(symbol);
  await page.getByRole('button', { name: '搜尋' }).click();
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
    const prices: Record<string, number> = { '1d': 568, '3d': 562, '5d': 561, '1m': 568, '3m': 560, '6m': 550, '1y': 540 };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(historyBody(range, prices[range] ?? 568)),
    });
  });
  return historyRanges;
}

test('search loads focus quote, intraday chart, MA legend defaults, and daily table', async ({ page }) => {
  const historyRanges = await setupAnalysis(page);

  await page.goto('/');
  await search(page, '2330');

  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');
  await expect(page.getByText('焦點個股分析')).toBeVisible();
  await expect(page.getByTestId('stock-quote-change')).toHaveText('▲ 2 (+0.35%)');
  await expect(page.getByTestId('stock-quote-market')).toHaveText('上市');
  await expect(page.getByTestId('focus-quote-grid')).toContainText('開盤價');
  await expect(page.getByTestId('focus-quote-grid')).toContainText('漲停價');
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();
  await expect(page.getByText('TradingView Lightweight Charts™')).toBeVisible();
  // Default range is 當日 (1d, 5m timeframe).
  await expect(page.getByRole('button', { name: '當日' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('5 分鐘 K')).toBeVisible();
  // MA legend defaults: only MA5 on.
  await expect(page.getByRole('button', { name: /MA5/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /MA10/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /MA20/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /MA60/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('MA 依目前 K 線週期計算')).toBeVisible();
  // Recent daily table still shows daily OHLCV on an intraday chart range.
  await expect(page.getByTestId('recent-trading-table')).toBeVisible();
  await expect(page.getByText('近期交易資料')).toBeVisible();
  await expect(page.getByText('最近 5 個交易日')).toBeVisible();
  await expect(page.getByText('2026-08-06')).toBeVisible();
  expect(historyRanges).toContain('1d');
  expect(historyRanges).toContain('1m');
});

test('MA legend toggles aria-pressed without refetching and persists across range switch', async ({ page }) => {
  const historyRanges = await setupAnalysis(page);

  await page.goto('/');
  await search(page, '2330');
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();

  const initialRequests = historyRanges.length;

  // Toggle MA5 off (default on)
  await page.getByRole('button', { name: /MA5/ }).click();
  await expect(page.getByRole('button', { name: /MA5/ })).toHaveAttribute('aria-pressed', 'false');
  expect(historyRanges.length).toBe(initialRequests);

  // Toggle MA10 on (default off)
  await page.getByRole('button', { name: /MA10/ }).click();
  await expect(page.getByRole('button', { name: /MA10/ })).toHaveAttribute('aria-pressed', 'true');
  expect(historyRanges.length).toBe(initialRequests);

  // Switch to 1M range
  await page.getByRole('button', { name: '1M' }).click();
  await expect(page.getByRole('button', { name: '1M' })).toHaveAttribute('aria-pressed', 'true');
  expect(historyRanges.length).toBe(initialRequests + 1);
  expect(historyRanges[historyRanges.length - 1]).toBe('1m');

  // Legend state preserved
  await expect(page.getByRole('button', { name: /MA5/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /MA10/ })).toHaveAttribute('aria-pressed', 'true');
});

test('all seven ranges refetch with the right range param', async ({ page }) => {
  const historyRanges = await setupAnalysis(page);

  await page.goto('/');
  await search(page, '2330');
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();

  for (const [label, value] of [
    ['3D', '3d'],
    ['5D', '5d'],
    ['1M', '1m'],
    ['3M', '3m'],
    ['6M', '6m'],
    ['1Y', '1y'],
  ] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(historyRanges[historyRanges.length - 1]).toBe(value);
  }
  await expect(page.getByText('日 K')).toBeVisible();
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
  await search(page, '2330');

  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');
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
  await search(page, '999999');

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
  await search(page, '999999');

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
      body: JSON.stringify(historyBody('1d', 568)),
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
  await search(page, '2330');

  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');
  await expect(page.getByTestId('stock-history-chart')).toBeVisible();

  // Switch to invalid symbol
  await search(page, '999999');

  await expect(page.getByText('查無此股票代號')).toBeVisible();
  await expect(page.getByTestId('stock-history-chart')).not.toBeVisible();
  expect(invalidHistoryCalls.length).toBe(0);
});
