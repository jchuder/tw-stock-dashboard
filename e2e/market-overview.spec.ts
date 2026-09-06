import { expect, test } from '@playwright/test';

const MOCK_MARKET_OVERVIEW = {
  taiex: {
    asOf: '2026-09-04',
    close: 46551.13,
    change: 693.47,
    changePercent: 1.51,
  },
  otc: {
    asOf: '2026-09-04',
    close: 402.48,
    change: 7.23,
    changePercent: 1.83,
  },
  institutional: {
    asOf: '2026-09-04',
    market: 'TWSE',
    foreignNetAmount: 56212953803,
    investmentTrustNetAmount: -910866463,
    dealerNetAmount: 6370061244,
    totalNetAmount: 61672148584,
  },
};

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

test('homepage loads TAIEX, OTC, and 上市三大法人 with positive/negative formatting', async ({
  page,
}) => {
  await page.route('**/api/v1/market/overview', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MARKET_OVERVIEW),
    });
  });

  await page.goto('/');

  // TAIEX
  const taiexCard = page.getByTestId('market-index-加權指數');
  await expect(taiexCard).toBeVisible();
  await expect(taiexCard).toContainText('加權指數');
  await expect(taiexCard).toContainText('46,551.13');
  await expect(taiexCard).toContainText('+693.47 (+1.51%)');
  await expect(taiexCard).toContainText('2026-09-04 收盤');

  // OTC
  const otcCard = page.getByTestId('market-index-櫃買指數');
  await expect(otcCard).toBeVisible();
  await expect(otcCard).toContainText('櫃買指數');
  await expect(otcCard).toContainText('402.48');
  await expect(otcCard).toContainText('+7.23 (+1.83%)');
  await expect(otcCard).toContainText('2026-09-04 收盤');

  // 上市三大法人
  const instCard = page.getByTestId('market-institutional');
  await expect(instCard).toBeVisible();
  await expect(instCard).toContainText('上市三大法人');
  await expect(instCard).toContainText('+562.1 億');
  await expect(instCard).toContainText('-9.1 億');
  await expect(instCard).toContainText('+63.7 億');
  await expect(instCard).toContainText('+616.7 億');
});

test('market overview 500 error does NOT break stock search', async ({ page }) => {
  await page.route('**/api/v1/market/overview', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 500, message: 'Failed to fetch market overview' }),
    });
  });

  await page.route('**/api/v1/stocks/2330/quote', (route) => {
    expect(new URL(route.request().url()).origin).toBe('http://localhost:3001');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(QUOTE_BODY),
    });
  });

  await page.goto('/');

  // 市場概況顯示錯誤
  await expect(page.getByText('市場概況載入失敗')).toBeVisible();

  // 搜尋功能正常工作
  await page.getByPlaceholder('2330').fill('2330');
  await page.getByRole('button', { name: '查詢' }).click();

  await expect(page.getByText('2330 台積電')).toBeVisible();
  await expect(page.getByText('568')).toBeVisible();
});
