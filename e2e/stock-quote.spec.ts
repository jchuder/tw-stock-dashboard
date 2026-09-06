import { expect, test } from '@playwright/test';

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

const FUGLE_BODY = {
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

const MIS_BODY = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
  ...ENRICHED_QUOTE,
  source: {
    provider: 'twse-mis',
    fallbackUsed: true,
    fetchedAt: '2026-09-06T03:45:06.000Z',
    asOf: '2026-09-04T05:30:00.000Z',
    cacheHit: false,
  },
};

const FALLBACK_TOAST = 'Fugle 即時行情暫時無法使用，已自動切換至 TWSE MIS';
const RECOVERY_TOAST = 'Fugle 行情服務已恢復，資料來源已切回 Fugle';

test('stock quote happy path', async ({ page }) => {
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FUGLE_BODY),
    });
  });

  await page.goto('/');
  await page.getByPlaceholder('請輸入股票代號').fill('2330');
  await page.getByRole('button', { name: '搜尋' }).click();

  await expect(page.getByTestId('stock-quote-title')).toHaveText('2330 台積電');
  await expect(page.getByTestId('stock-quote-market')).toHaveText('上市');
  await expect(page.getByTestId('stock-quote-price')).toHaveText('568');
  await expect(page.getByTestId('stock-quote-change')).toHaveText('▲ 2 (+0.35%)');
  await expect(page.getByText('昨收 566')).toBeVisible();
  await expect(page.getByText('資料來源：Fugle API Connected').first()).toBeVisible();
  await expect(page.getByText('最後更新：2026/09/04 13:30:00')).toBeVisible();
  // Enriched session grid
  await expect(page.getByTestId('focus-quote-grid')).toContainText('開盤價');
  await expect(page.getByTestId('focus-quote-grid')).toContainText('漲停價');
  await expect(page.getByText(FALLBACK_TOAST)).toHaveCount(0);
});

test('falling quote states explicit previous-day wording in green', async ({ page }) => {
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...FUGLE_BODY, price: 560, change: -6, changePercent: -1.06 }),
    });
  });

  await page.goto('/');
  await page.getByPlaceholder('請輸入股票代號').fill('2330');
  await page.getByRole('button', { name: '搜尋' }).click();

  await expect(page.getByTestId('stock-quote-change')).toHaveText('▼ 6 (-1.06%)');
});

test('flat quote states 持平 wording', async ({ page }) => {
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...FUGLE_BODY, price: 566, change: 0, changePercent: 0 }),
    });
  });

  await page.goto('/');
  await page.getByPlaceholder('請輸入股票代號').fill('2330');
  await page.getByRole('button', { name: '搜尋' }).click();

  await expect(page.getByTestId('stock-quote-change')).toHaveText('0 (0.00%)');
});

test('source fallback and recovery toasts', async ({ page }) => {
  const script = [FUGLE_BODY, MIS_BODY, { ...MIS_BODY, source: { ...MIS_BODY.source, cacheHit: true } }, FUGLE_BODY];
  let calls = 0;
  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    const body = script[Math.min(calls, script.length - 1)];
    calls += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/');

  // Response 1: live Fugle (boot autofocus query) — badge, no toast.
  await expect(page.getByText('資料來源：Fugle API Connected').first()).toBeVisible();
  await expect(page.getByText(FALLBACK_TOAST)).toHaveCount(0);

  await page.getByPlaceholder('請輸入股票代號').fill('2330');
  const search = page.getByRole('button', { name: '搜尋' });

  // Response 2: live MIS fallback — badge switches, one fallback toast.
  await search.click();
  await expect(page.getByText('資料來源：TWSE MIS').first()).toBeVisible();
  await expect(page.getByText(FALLBACK_TOAST)).toHaveCount(1);

  // Response 3: cached MIS — badge stays, no additional toast.
  await search.click();
  await expect(page.getByText('快取')).toBeVisible();
  await expect(page.getByText(FALLBACK_TOAST)).toHaveCount(1);
  await expect(page.getByText(RECOVERY_TOAST)).toHaveCount(0);

  // Response 4: live Fugle again — recovery toast, badge back.
  await search.click();
  await expect(page.getByText(RECOVERY_TOAST)).toHaveCount(1);
  await expect(page.getByText('資料來源：Fugle API Connected').first()).toBeVisible();
});
