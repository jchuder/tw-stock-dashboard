import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: 'apps/api',
      port: 3001,
      reuseExistingServer: true,
      stdout: 'pipe',
    },
    {
      command: 'pnpm preview',
      cwd: 'apps/web',
      port: 4173,
      reuseExistingServer: true,
      stdout: 'pipe',
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
