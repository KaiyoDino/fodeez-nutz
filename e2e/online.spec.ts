// Leaderboards and achievements in the browser. The dev server runs the leaderboard API with
// an in-memory store and a "type any name" sign-in (tools/api-plugin.ts).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routesDir = join(import.meta.dirname, '..', 'src', 'data', 'routes');
const route = (name: string) => JSON.parse(readFileSync(join(routesDir, `${name}.json`), 'utf8'));

interface GameApi {
  phase(): string;
  save(): { wheels: string; progress: { unlocked: Record<string, string> }; online: { user: { name: string } } | null };
  runRoute(route: unknown): boolean;
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('beating a level earns its achievement and wheels', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const won = await page.evaluate(r => (window as unknown as { __game: GameApi }).__game.runRoute(r), route('tower-newage'));
  expect(won).toBe(true);
  await expect(page.getByRole('heading', { name: 'YIPPEE!' })).toBeVisible();
  await expect(page.locator('.unlocked')).toContainText('New Heights');
  await expect(page.locator('.unlocked')).toContainText('Neon');
  await expect(page.locator('.unlocked')).toContainText('Five-Minute Climb');
  await page.getByRole('button', { name: 'Title' }).click();
  await page.getByRole('button', { name: 'Achievements' }).click();
  await expect(page.getByRole('heading', { name: 'Achievements' })).toBeVisible();
  const wheels = page.getByRole('radiogroup', { name: 'Wheels' });
  await expect(wheels.getByRole('radio', { name: 'Girder wheels, locked: earn Old School' })).toBeDisabled();
  await wheels.getByRole('radio', { name: 'Neon wheels' }).click();
  await expect(wheels.getByRole('radio', { name: 'Neon wheels' })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => (window as unknown as { __game: GameApi }).__game.save().wheels)).toBe('neon');
  expect(errors).toEqual([]);
});

test('sign in, post a time, and watch it from the leaderboard', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Leaderboards' }).click();
  await expect(page.getByRole('heading', { name: 'Leaderboards' })).toBeVisible();

  // the sign-in page opens in a new tab; the game notices when it's done
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Sign in with itch.io' }).click();
  const popup = await popupPromise;
  await expect(page.getByRole('heading', { name: 'Sign in with itch.io' })).toBeVisible();
  await popup.getByRole('textbox', { name: 'Name' }).fill('Tester');
  await popup.getByRole('button', { name: 'Sign in' }).click();
  await expect(popup.getByRole('heading', { name: 'Signed in' })).toBeVisible();
  await expect(page.locator('.account')).toContainText('Tester', { timeout: 10_000 });
  await popup.close().catch(() => undefined);

  // win, and the time goes up by itself
  const won = await page.evaluate(r => (window as unknown as { __game: GameApi }).__game.runRoute(r), route('crane-original'));
  expect(won).toBe(true);
  await expect(page.locator('.online-status')).toContainText(/on the leaderboard/, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Title' }).click();
  await page.getByRole('button', { name: 'Leaderboards' }).click();
  await page.getByRole('radio', { name: 'The Crane · Original' }).click();
  const row = page.locator('.board-row.mine');
  await expect(row).toContainText('Tester');
  await row.getByRole('button', { name: 'Watch' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __game: GameApi }).__game.phase())).toBe('replay');
  await expect(page.locator('.replay-title')).toContainText('Tester');
  expect(errors).toEqual([]);
});
