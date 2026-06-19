import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../../playwright/.auth/trainer.json');

setup('authenticate trainer', async ({ page, context }) => {
  const email = process.env.TEST_TRAINER_EMAIL;
  const password = process.env.TEST_TRAINER_PASSWORD;

  if (!email || !password) {
    setup.skip(true, 'TEST_TRAINER_EMAIL and TEST_TRAINER_PASSWORD must be set');
    return;
  }

  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.waitForSelector('input#email', { timeout: 30000 });
  await page.fill('input#email', email);
  await page.fill('input#password', password);
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/trainer/, { timeout: 30000 });
  await expect(page.locator('h2:text("Dashboard")')).toBeVisible({ timeout: 15000 });

  await context.storageState({ path: authFile });
});
