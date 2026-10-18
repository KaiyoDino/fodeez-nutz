import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

declare global {
  interface Window {
    __game: {
      state(): { mode: string; won: boolean; dude: { x: number; y: number }; newage: { hook: { state: string } } | null; original: { wantsHook: boolean } | null };
      phase(): string;
      replayTick(): number;
      runRoute(route: unknown): boolean;
    };
  }
}

const routesDir = join(import.meta.dirname, '..', 'src', 'data', 'routes');
const route = (name: string) => JSON.parse(readFileSync(join(routesDir, `${name}.json`), 'utf8'));

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

const phase = (page: Page) => page.evaluate(() => window.__game.phase());

/** Without ?debug the game opens on "Click to start" (unless the browser allows autoplay). */
async function passGate(page: Page): Promise<void> {
  const gate = page.getByRole('button', { name: 'Click to start' });
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(gate.or(play)).toBeVisible();
  if (await gate.isVisible()) await gate.click();
  await expect(play).toBeVisible();
}

test('title screen loads cleanly', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Fodeez Nutz' })).toBeVisible();
  await passGate(page);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replays' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('pick a map and a mode, then fire the plunger', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a map' })).toBeVisible();
  await page.getByRole('button', { name: 'Climb The Crane' }).click();
  await expect(page.getByRole('heading', { name: 'The Crane' })).toBeVisible();
  await page.locator('.card.newage').getByRole('button', { name: 'New run' }).click();
  await expect.poll(() => phase(page)).toBe('playing');
  const box = (await page.locator('#game').boundingBox())!;
  await page.mouse.move(box.width / 2, box.height * 0.2);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__game.state().newage!.hook.state)).not.toBe('idle');
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('escape pauses, and settings and the run survive a reload', async ({ page }) => {
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Climb The Tower' }).click();
  await page.locator('.card.original').getByRole('button', { name: 'New run' }).click();
  await expect.poll(() => phase(page)).toBe('playing');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  const aim = page.getByLabel('Aim guide');
  await expect(aim).toBeChecked();
  await aim.uncheck();
  // zoom and crosshair size are picked from a row of buttons
  await page.getByRole('radiogroup', { name: 'Zoom' }).getByRole('radio', { name: 'Close' }).click();
  await page.getByRole('radiogroup', { name: 'Crosshair' }).getByRole('radio', { name: 'Large' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => phase(page)).toBe('playing');
  await page.reload();
  await expect(page.getByRole('button', { name: /Continue · The Tower, Original/ })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Aim guide')).not.toBeChecked();
  await expect(page.getByRole('radiogroup', { name: 'Zoom' }).getByRole('radio', { name: 'Close' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radiogroup', { name: 'Crosshair' }).getByRole('radio', { name: 'Large' })).toHaveAttribute('aria-checked', 'true');
});

for (const name of ['tower-original', 'tower-newage', 'crane-newage', 'crane-original']) {
  test(`winning ${name} saves a replay that plays back to the same win`, async ({ page }) => {
    test.skip(!existsSync(join(routesDir, `${name}.json`)), 'no recorded route yet');
    const errors = collectErrors(page);
    await page.goto('/?debug');
    const won = await page.evaluate(r => window.__game.runRoute(r), route(name));
    expect(won).toBe(true);
    await expect(page.getByRole('heading', { name: 'YIPPEE!' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('New best time')).toBeVisible();
    // watch our own run back at top speed
    await page.getByRole('button', { name: 'Watch replay' }).click();
    await expect.poll(() => phase(page)).toBe('replay');
    await page.getByRole('button', { name: '16×' }).click();
    await expect(page.getByRole('heading', { name: 'Replay over' })).toBeVisible({ timeout: 45_000 });
    expect(errors).toEqual([]);
  });
}

test('the replays menu plays the bot runs, with seeking', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Replays' }).click();
  await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
  await page.getByRole('button', { name: 'Watch' }).first().click();
  await expect.poll(() => phase(page)).toBe('replay');
  await expect.poll(() => page.evaluate(() => window.__game.replayTick())).toBeGreaterThan(20);
  // seek near the end with the slider, then let it finish
  await page.locator('#replay-seek').fill('990');
  await expect(page.getByRole('heading', { name: 'Replay over' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Watch again' }).click();
  await expect.poll(() => page.evaluate(() => window.__game.replayTick())).toBeLessThan(600);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('phone-sized screen has no sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await passGate(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('.card.map-crane')).toBeVisible();
  const box = (await page.locator('.panel').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
