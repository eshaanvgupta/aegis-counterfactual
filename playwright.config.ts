import { defineConfig, devices } from '@playwright/test';

/** Smoke-tests the static, key-less evidence build (pnpm build:static first).
 *  PW_CHANNEL=msedge|chrome uses an installed browser instead of Playwright's bundled Chromium. */
const channel = process.env.PW_CHANNEL || undefined;
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel } },
  ],
  webServer: { command: 'node scripts/serve-static.mjs', url: 'http://127.0.0.1:3100', reuseExistingServer: true, timeout: 20_000 },
});
