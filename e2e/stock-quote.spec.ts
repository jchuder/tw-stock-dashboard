import { expect, test } from '@playwright/test';

test('stock quote happy path', async ({ page }) => {
  await page.route('**/api/stocks/2330/quote', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        symbol: '2330',
        name: '台積電',
        market: 'TWSE',
        price: 568,
        previousClose: 566,
        change: 2,
        changePercent: 0.35,
      }),
    }),
  );

  await page.goto('/');
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('2330 台積電')).toBeVisible();
  await expect(page.getByText('568')).toBeVisible();
  await expect(page.getByText('+2')).toBeVisible();
  await expect(page.getByText('+0.35%')).toBeVisible();
});
