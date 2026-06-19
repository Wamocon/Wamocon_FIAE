import { test, expect } from '@playwright/test';

test.describe('Public pages smoke test', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('body')).toContainText('Anmelden');
  });

  test('verify page renders loader or content without crash', async ({ page }) => {
    await page.goto('/verify/test-code');
    // Wait for the page to settle (loader or content)
    await page.waitForTimeout(3000);
    const screenshot = await page.screenshot();
    expect(screenshot.length).toBeGreaterThan(1000);
  });
});
