import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for Wamocon FIAE.
 *
 * To run E2E tests you need a running dev server and valid test credentials.
 * Set these in a .env.test.local file or export them before running tests:
 *   TEST_BASE_URL=http://localhost:3002
 *   TEST_TRAINER_EMAIL=trainer1@gmail.com
 *   TEST_TRAINER_PASSWORD=...
 *
 * Run `npx playwright test tests/e2e/auth.setup.ts` first to regenerate the
 * authenticated storage state in playwright/.auth/trainer.json.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
