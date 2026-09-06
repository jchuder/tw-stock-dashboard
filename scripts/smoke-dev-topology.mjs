import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const API_PORT = 3001;
const WEB_PORT = 5173;
const API_URL = `http://localhost:${API_PORT}`;
const API_HEALTH_URL = `${API_URL}/health`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

async function isPortOpen(url) {
  try {
    const res = await fetch(url);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const spawnedProcesses = [];

function killSpawnedProcesses() {
  for (const proc of spawnedProcesses) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

process.on('SIGINT', () => {
  killSpawnedProcesses();
  process.exit(130);
});

process.on('SIGTERM', () => {
  killSpawnedProcesses();
  process.exit(143);
});

async function main() {
  console.log('[Smoke] Checking dev topology servers...');

  const apiAlreadyRunning = await isPortOpen(API_HEALTH_URL);
  if (!apiAlreadyRunning) {
    console.log('[Smoke] Starting Nest API server with pnpm dev:api...');
    const apiProc = spawn('pnpm', ['dev:api'], {
      stdio: 'pipe',
    });
    spawnedProcesses.push(apiProc);
  }

  const webAlreadyRunning = await isPortOpen(WEB_URL);
  if (!webAlreadyRunning) {
    console.log('[Smoke] Starting Vite dev server...');
    const webProc = spawn('pnpm', ['--filter', '@tw-stock-dashboard/web', 'dev'], {
      stdio: 'pipe',
    });
    spawnedProcesses.push(webProc);
  }

  const apiReady = await waitForServer(API_HEALTH_URL, 30000);
  if (!apiReady) {
    throw new Error(`API server failed to start on ${API_URL}`);
  }

  const webReady = await waitForServer(WEB_URL, 30000);
  if (!webReady) {
    throw new Error(`Web dev server failed to start on ${WEB_URL}`);
  }

  console.log('[Smoke] Dev topology servers ready. Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const apiRequests = {
    overview: [],
    quote: [],
    history: [],
  };

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/v1/market/overview')) {
      apiRequests.overview.push(url);
    } else if (url.includes('/api/v1/stocks/2330/quote')) {
      apiRequests.quote.push(url);
    } else if (url.includes('/api/v1/stocks/2330/history')) {
      apiRequests.history.push(url);
    }
  });

  try {
    console.log(`[Smoke] Navigating to ${WEB_URL}...`);
    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded' });

    console.log('[Smoke] Verifying market overview loads through :3001...');
    await page.locator('[data-testid="market-index-加權指數"]').waitFor({ timeout: 15000 });
    await page.locator('[data-testid="market-index-櫃買指數"]').waitFor({ timeout: 15000 });
    await page.locator('[data-testid="market-institutional"]').waitFor({ timeout: 15000 });

    if (apiRequests.overview.length === 0) {
      throw new Error('No network request detected for market overview');
    }
    for (const url of apiRequests.overview) {
      const origin = new URL(url).origin;
      if (origin !== API_URL) {
        throw new Error(`Market overview request origin mismatch: expected ${API_URL}, got ${origin}`);
      }
    }

    console.log('[Smoke] Querying stock 2330...');
    await page.getByPlaceholder('2330').fill('2330');
    await page.getByRole('button', { name: '查詢' }).click();

    console.log('[Smoke] Waiting for quote and chart...');
    await page.locator('text=2330 台積電').waitFor({ timeout: 15000 });
    await page.locator('[data-testid="stock-history-chart"]').waitFor({ timeout: 15000 });

    if (apiRequests.quote.length === 0) {
      throw new Error('No network request detected for stock quote');
    }
    for (const url of apiRequests.quote) {
      const origin = new URL(url).origin;
      if (origin !== API_URL) {
        throw new Error(`Stock quote request origin mismatch: expected ${API_URL}, got ${origin}`);
      }
    }

    if (apiRequests.history.length === 0) {
      throw new Error('No network request detected for stock history');
    }
    for (const url of apiRequests.history) {
      const origin = new URL(url).origin;
      if (origin !== API_URL) {
        throw new Error(`Stock history request origin mismatch: expected ${API_URL}, got ${origin}`);
      }
    }

    console.log('[Smoke] Dev topology live smoke test PASSED:');
    console.log(`  - Market Overview: ${apiRequests.overview.length} requests -> ${API_URL}`);
    console.log(`  - 2330 Quote: ${apiRequests.quote.length} requests -> ${API_URL}`);
    console.log(`  - 2330 History: ${apiRequests.history.length} requests -> ${API_URL}`);
  } finally {
    await browser.close();
    killSpawnedProcesses();
  }
}

main().catch((err) => {
  console.error('[Smoke] FAILED:', err);
  killSpawnedProcesses();
  process.exit(1);
});
