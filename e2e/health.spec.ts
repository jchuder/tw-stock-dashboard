import { test, expect } from '@playwright/test';

test('infrastructure health', async ({ page }) => {
  const res = await page.request.get('http://localhost:3001/health');
  expect(res.ok()).toBe(true);
  const data = await res.json();
  expect(data.status).toBe('ok');

  await page.goto('/');
  await expect(page.getByText('Taiwan Stock Dashboard')).toBeVisible();
});
