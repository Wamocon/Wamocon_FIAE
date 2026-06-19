import { chromium } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../playwright/.auth/trainer.json');

async function run() {
  const email = process.env.TEST_TRAINER_EMAIL;
  const password = process.env.TEST_TRAINER_PASSWORD;
  const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3002';

  if (!email || !password) {
    console.error('TEST_TRAINER_EMAIL and TEST_TRAINER_PASSWORD must be set');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.waitForSelector('input#email', { timeout: 60000 });
    await page.fill('input#email', email);
    await page.fill('input#password', password);
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/trainer/, { timeout: 60000 });
    await page.waitForSelector('text=Dashboard', { timeout: 15000 });

    await context.storageState({ path: authFile });
    console.log(`Auth state saved to ${authFile}`);
  } catch (error) {
    console.error('Failed to generate auth state:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
