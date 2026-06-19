import { test, expect } from '@playwright/test';

test('debug login page', async ({ page }) => {
  const consoleLogs: string[] = [];
  page.on('console', msg => consoleLogs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => consoleLogs.push(`PAGEERROR: ${err.message}`));

  await page.goto('/login');
  await page.waitForTimeout(3000);

  console.log('=== CONSOLE LOGS ===');
  consoleLogs.forEach(log => console.log(log));
  console.log('=== END LOGS ===');

  await expect(page.locator('body')).toContainText('Anmelden');
});
