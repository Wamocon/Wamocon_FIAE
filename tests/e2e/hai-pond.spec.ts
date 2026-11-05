import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';

/**
 * The HAI figure always stands in its pond (the grown HAI symbol), whatever
 * the width of the chat panel. Measured in a real browser: the center of the
 * pond (the round symbol, scaled) and the center of the water ellipse of the
 * figure may differ by 2 px at most, at several panel widths (key, pull with
 * the mouse, double click), while the pointer is still down (live, no lagging),
 * when the panel goes out and in, when the window changes, while the figure
 * dives in, and on a phone (sheet over the page).
 *
 * Needs a running app (TEST_BASE_URL, default http://localhost:3002) and a
 * logged-in person of an organization with the HAI (PRO), the same storage
 * state as the other specs (playwright/.auth/trainer.json, see
 * auth.setup.ts). The voice assistant is switched on for the page by answering
 * GET /api/hai/voice here, no microphone and no speech provider is used.
 * HAI_E2E_PATH is the page to start from (default /trainer/dashboard).
 */

const authFile = path.join(__dirname, '../../playwright/.auth/trainer.json');
const startPath = process.env.HAI_E2E_PATH || '/trainer/dashboard';
const TOLERANCE = 2;

if (fs.existsSync(authFile)) test.use({ storageState: authFile });

interface Centers {
  pond: { x: number; y: number };
  figure: { x: number; y: number };
  dx: number;
  dy: number;
  panelWidth: number | null;
}

async function open(page: Page, width: number, height: number) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_main_completed', 'true');
    localStorage.setItem('onboarding_hai_completed', 'true');
    localStorage.removeItem('hai-panel-width');
  });
  await page.route('**/api/hai/voice', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: true }),
    })
  );
  await page.route('**/api/hai/voice/config', route =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  );
  await page.setViewportSize({ width, height });
  await page.goto(startPath);
  await page.locator('[data-hai-handle]').first().waitFor({ timeout: 60000 });
}

async function openPanel(page: Page) {
  const panel = page.getByTestId('hai-chat-panel');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.locator('[data-hai-handle]').first().click();
    await panel.waitFor({ timeout: 30000 });
  }
}

async function openVoice(page: Page) {
  await page
    .locator('[data-testid="hai-voice-mode-button"]:visible')
    .first()
    .click();
  await page.getByTestId('hai-voice-figure').waitFor({ timeout: 30000 });
  // the figure has risen, the pond has grown (the symbol scales for 500 ms)
  await page.waitForTimeout(1200);
}

async function centers(page: Page): Promise<Centers> {
  return page.evaluate(() => {
    const center = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const handle = document.querySelector('[data-hai-handle]');
    const water = document.querySelector(
      '[data-testid="hai-voice-figure"] .hf-water'
    );
    if (!handle || !water) throw new Error('pond or figure is missing');
    const pond = center(handle);
    const figure = center(water);
    const panel = document.querySelector('[data-testid="hai-chat-panel"]');
    return {
      pond,
      figure,
      dx: figure.x - pond.x,
      dy: figure.y - pond.y,
      panelWidth: panel
        ? Math.round(panel.getBoundingClientRect().width)
        : null,
    };
  });
}

async function expectInPond(page: Page, label: string) {
  const c = await centers(page);
  const detail = `${label}: panel ${c.panelWidth} px, pond x ${c.pond.x.toFixed(1)}, figure x ${c.figure.x.toFixed(1)}, dx ${c.dx.toFixed(1)}, dy ${c.dy.toFixed(1)}`;
  expect(Math.abs(c.dx), detail).toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(c.dy), detail).toBeLessThanOrEqual(TOLERANCE);
  return c;
}

const settle = (page: Page) => page.waitForTimeout(600);

async function pullTo(page: Page, panelWidth: number) {
  const viewport = page.viewportSize()!;
  const box = (await page.getByTestId('hai-dock-handle').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const target = viewport.width - panelWidth;
  await page.mouse.move((x + target) / 2, y, { steps: 4 });
  await page.mouse.move(target, y, { steps: 4 });
  // live: measured with the pointer still down, two frames after the last move
  await page.evaluate(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expectInPond(page, `pulled towards ${panelWidth} px (pointer down)`);
  await page.mouse.up();
  await settle(page);
  await expectInPond(page, `pulled towards ${panelWidth} px (released)`);
}

test.describe('HAI figure stands in its pond', () => {
  // the first load of a page in a dev server can be slow
  test.setTimeout(120_000);
  test.beforeEach(() => {
    test.skip(
      !fs.existsSync(authFile),
      'No stored login (playwright/.auth/trainer.json)'
    );
  });

  test('desktop: at every width of the panel, while pulled, in and out, resize and dive', async ({
    page,
  }) => {
    await open(page, 1440, 900);
    await openPanel(page);
    await openVoice(page);
    await expectInPond(page, 'default width');

    // five widths by key (min, a few steps, large steps, max) and by double click
    const handle = page.getByTestId('hai-dock-handle');
    await handle.focus();
    const widths = new Set<number>();
    for (const key of [
      'Home',
      'ArrowLeft',
      'ArrowLeft',
      'Shift+ArrowLeft',
      'Shift+ArrowLeft',
      'End',
      'ArrowRight',
    ]) {
      await page.keyboard.press(key);
      await settle(page);
      const c = await expectInPond(page, `key ${key}`);
      widths.add(c.panelWidth!);
    }
    expect(widths.size).toBeGreaterThanOrEqual(5);
    await handle.dblclick();
    await settle(page);
    await expectInPond(page, 'double click (default width)');

    // pulled with the mouse
    for (const width of [720, 320, 560]) await pullTo(page, width);

    // the panel goes out and in with the figure open
    await pullTo(page, 640);
    await page.locator('[data-hai-handle]').first().click();
    await settle(page);
    await expectInPond(page, 'panel closed');
    await page.locator('[data-hai-handle]').first().click();
    await settle(page);
    await expectInPond(page, 'panel open again');

    // the window changes
    await page.setViewportSize({ width: 1100, height: 900 });
    await settle(page);
    await expectInPond(page, 'window 1100 px');
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page);
    await expectInPond(page, 'window 1440 px');

    // the figure dives in: it stays in the pond until it is gone
    await page.getByTestId('hai-voice-close').click();
    await page.waitForTimeout(150);
    await expectInPond(page, 'diving');
  });

  test('phone: the sheet over the page, the figure stands in the pond', async ({
    page,
  }) => {
    await open(page, 390, 844);
    await openPanel(page);
    await openVoice(page);
    await expectInPond(page, 'phone 390 px');
  });

  test('window of 800 px: the panel gives way to the figure (under 1024 px), the figure stands in the pond', async ({
    page,
  }) => {
    await open(page, 800, 900);
    await openPanel(page);
    await openVoice(page);
    await expectInPond(page, 'window 800 px');
  });

  test('window of 1050 px with the navigation open: the panel cannot dock (sheet moved by 420 px), the figure follows', async ({
    page,
  }) => {
    await open(page, 1050, 900);
    await page.getByLabel('Toggle sidebar').first().click();
    await openPanel(page);
    await expect(page.locator('[data-hai-anchor]')).toHaveAttribute(
      'data-docked',
      'false'
    );
    await openVoice(page);
    await expectInPond(page, 'sheet at 1050 px');
  });
});
