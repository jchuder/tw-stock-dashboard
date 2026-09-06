import { expect, test } from '@playwright/test';

const FUGLE_BODY = {
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

const MIS_BODY = {
  symbol: '2330',
  name: '台積電',
  market: 'TWSE',
  price: 568,
  previousClose: 566,
  change: 2,
  changePercent: 0.35,
  source: {
    provider: 'twse-mis',
    fallbackUsed: true,
    fetchedAt: '2026-09-05T04:40:03.000Z',
    asOf: null,
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
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('2330 台積電')).toBeVisible();
  await expect(page.getByText('568')).toBeVisible();
  await expect(page.getByText('+2')).toBeVisible();
  await expect(page.getByText('+0.35%')).toBeVisible();
  await expect(page.getByText('資料來源：Fugle')).toBeVisible();
  await expect(page.getByText(FALLBACK_TOAST)).toHaveCount(0);
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
  await page.getByPlaceholder('2330').fill('2330');
  const search = page.getByRole('button', { name: '查詢' });

  // Response 1: live Fugle — badge, no toast.
  await search.click();
  await expect(page.getByText('資料來源：Fugle')).toBeVisible();
  await expect(page.getByText(FALLBACK_TOAST)).toHaveCount(0);

  // Response 2: live MIS fallback — badge switches, one fallback toast.
  await search.click();
  await expect(page.getByText('資料來源：TWSE MIS')).toBeVisible();
  await expect(page.getByText(FALLBACK_TOAST)).toHaveCount(1);

  // Response 3: cached MIS — badge stays, no additional toast.
  await search.click();
  await expect(page.getByText('快取')).toBeVisible();
  await expect(page.getByText(FALLBACK_TOAST)).toHaveCount(1);
  await expect(page.getByText(RECOVERY_TOAST)).toHaveCount(0);

  // Response 4: live Fugle again — recovery toast, badge back.
  await search.click();
  await expect(page.getByText(RECOVERY_TOAST)).toHaveCount(1);
  await expect(page.getByText('資料來源：Fugle')).toBeVisible();
});
