import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

declare global {
  interface Window {
    __game: {
      state(): { mode: string; won: boolean; dude: { x: number; y: number }; newage: { hook: { state: string } } | null; original: { wantsHook: boolean } | null };
      phase(): string;
      runRoute(route: unknown): boolean;
    };
  }
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('title screen loads cleanly', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Fodeez Nutz' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'How to play' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('start a New Age run from the menus and fire the plunger', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a mode' })).toBeVisible();
  await page.locator('.card.newage').getByRole('button', { name: 'New run' }).click();
  await expect.poll(() => page.evaluate(() => window.__game.phase())).toBe('playing');
  // fire straight up from the middle of the screen and hold
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.move(box.width / 2, box.height * 0.2);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__game.state().newage!.hook.state)).not.toBe('idle');
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('escape pauses, and settings survive a reload', async ({ page }) => {
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('.card.original').getByRole('button', { name: 'New run' }).click();
  await expect.poll(() => page.evaluate(() => window.__game.phase())).toBe('playing');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  const aim = page.getByLabel('Aim guide');
  await expect(aim).toBeChecked();
  await aim.uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => page.evaluate(() => window.__game.phase())).toBe('playing');
  await page.reload();
  // the run was saved, so the title offers to continue it
  await expect(page.getByRole('button', { name: /Continue · Original/ })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Aim guide')).not.toBeChecked();
});

for (const mode of ['original', 'newage'] as const) {
  test(`the recorded ${mode} route reaches the win screen`, async ({ page }) => {
    const errors = collectErrors(page);
    const route = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'tests', 'routes', `${mode}.json`), 'utf8'));
    await page.goto('/?debug');
    const won = await page.evaluate(r => window.__game.runRoute(r), route);
    expect(won).toBe(true);
    await expect(page.getByRole('heading', { name: 'YIPPEE!' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('New best time')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('phone-sized screen has no sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('.card.newage')).toBeVisible();
  // every panel fits inside the screen
  const box = (await page.locator('.panel').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
