import { test, expect, Page } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../../playwright/.auth/trainer.json');

async function dismissTour(page: Page) {
  // Try to skip the HAI onboarding tour if visible
  const skipButton = page.locator('button:has-text("Überspringen")');
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click({ force: true }).catch(() => {});
  }
}

async function waitForTraineeCards(page: Page) {
  await page.waitForSelector('button:has-text("@")', { timeout: 15000 });
}

async function goToReviewStep(page: Page) {
  await waitForTraineeCards(page);
  const traineeCard = page.locator('button:has-text("@")').first();
  await traineeCard.click();
  await page.click('text=Weiter zur Vorschau');
  // Wait for analysis loader to disappear and review step to render
  await page.waitForSelector('text=Analysiere Tätigkeitsnachweise', { state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await dismissTour(page);
}

test.use({ storageState: authFile });

test.describe('Arbeitszeugnis E2E', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.TEST_TRAINER_EMAIL || !process.env.TEST_TRAINER_PASSWORD) {
      test.skip(true, 'Credentials not configured');
      return;
    }
    await page.goto('/trainer/activity-reports/arbeitszeugnis');
    await page.waitForLoadState('networkidle');
    await dismissTour(page);
  });

  test('should load certificate generator page', async ({ page }) => {
    await waitForTraineeCards(page);
    await expect(page.locator('h1').nth(1)).toContainText('Arbeitszeugnis');
    await expect(page.locator('text=Alle Auszubildenden')).toBeVisible();
  });

  test('should show validation errors before certificate can be issued', async ({ page }) => {
    await goToReviewStep(page);

    await expect(page.locator('h3:has-text("Gesamtnote")')).toBeVisible();

    // Scroll to the issue button area
    await page.locator('button:has-text("Zeugnis erstellen")').scrollIntoViewIfNeeded().catch(() => {});
    const downloadButton = page.locator('button:has-text("Zeugnis erstellen")');
    await expect(downloadButton).toBeDisabled();

    await expect(page.locator('text=Folgende Angaben fehlen noch:')).toBeVisible();
  });

  test('should generate overall assessment without AI', async ({ page }) => {
    await goToReviewStep(page);
    await dismissTour(page);

    await page.click('button:has-text("Befriedigend")');
    await page.click('text=Gesamturteil ohne KI generieren');

    await expect(page.locator('textarea[placeholder*="Gesamturteil"]')).toHaveValue(/Note 3/, { timeout: 10000 });
  });

  test('should generate overall assessment with AI', async ({ page }) => {
    await goToReviewStep(page);
    await dismissTour(page);

    await page.click('button:has-text("Gut")');
    const aiButton = page.locator('button:has-text("Gesamturteil mit KI generieren")');
    await aiButton.click();

    await expect(page.locator('textarea[placeholder*="Gesamturteil"]')).not.toHaveValue('', { timeout: 20000 });
  });
});
