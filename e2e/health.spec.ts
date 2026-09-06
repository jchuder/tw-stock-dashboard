import { test, expect } from '@playwright/test';

test('infrastructure health', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Taiwan Stock Dashboard')).toBeVisible();
  await expect(page.getByText('API Connected')).toBeVisible();
});
