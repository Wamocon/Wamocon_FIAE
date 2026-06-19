import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const screenshotsDir = path.join(__dirname, '../../test-results/manual-screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

test.describe('Manual browser screenshots', () => {
  test('login page screenshot', async ({ page }) => {
    await page.goto('/login');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotsDir, '01-login-page.png'), fullPage: true });

    const bodyText = await page.locator('body').innerText();
    console.log('Login page text:', bodyText.slice(0, 200));
  });

  test('verify page screenshot', async ({ page }) => {
    await page.goto('/verify/invalid-code-12345');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(screenshotsDir, '02-verify-invalid-code.png'), fullPage: true });

    const bodyText = await page.locator('body').innerText();
    console.log('Verify page text:', bodyText.slice(0, 200));
  });

  test('login attempt without credentials shows validation', async ({ page }) => {
    await page.goto('/login');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotsDir, '03-login-validation.png'), fullPage: true });
  });
});
