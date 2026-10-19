// The timer setting (off by default) and the restart key: bound in Settings, it starts a run
// over at once, and in the map maker it plays the map from the start.
import { expect, test, type Page } from '@playwright/test';
import { collectErrors } from './helpers';

interface GameApi {
  phase(): string;
  state(): { stats: { ticks: number } };
}
const phase = (page: Page) => page.evaluate(() => (window as unknown as { __game: GameApi }).__game.phase());
const ticks = (page: Page) => page.evaluate(() => (window as unknown as { __game: GameApi }).__game.state().stats.ticks);

test('the timer is off by default, and old saves that had it on start with it off', async ({ page }) => {
  await page.goto('/?debug&menu=settings');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByLabel('Show timer')).not.toBeChecked();
  // a save from before (the timer was on by default then), put there before the game loads
  // (the game writes its own save when the page goes away)
  await page.addInitScript(() => {
    if (sessionStorage.getItem('planted')) return;
    sessionStorage.setItem('planted', '1');
    localStorage.setItem('fodeez-nutz/v1', JSON.stringify({ v: 2, settings: { showTimer: true, aimGuide: false } }));
  });
  await page.reload();
  await expect(page.getByLabel('Show timer')).not.toBeChecked();
  await expect(page.getByLabel('Aim guide')).not.toBeChecked();
  // turned on now, it stays on
  await page.getByLabel('Show timer').check();
  await page.reload();
  await expect(page.getByLabel('Show timer')).toBeChecked();
});

test('bind a restart key, restart a run with it, and play from the start in the map maker', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug&menu=settings');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const key = page.locator('#set-restart');
  await expect(key).toHaveText('Not set');
  await key.click();
  await expect(key).toHaveText('Press a key…');
  // keys the game uses are refused
  await page.keyboard.press('Space');
  await expect(page.getByText('Space fires the plunger')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(key).toHaveText('Not set');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await key.click();
  await page.keyboard.press('Shift+R');
  await expect(key).toHaveText('Shift+R');
  await page.reload();
  await expect(page.locator('#set-restart')).toHaveText('Shift+R');
  await page.getByRole('button', { name: 'Done' }).click();

  // in a run: it starts over straight away (plain R, without Shift, doesn't)
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Climb The Tower' }).click();
  await page.locator('.card.newage').getByRole('button', { name: 'New run' }).click();
  await expect.poll(() => ticks(page)).toBeGreaterThan(90);
  await page.keyboard.press('r');
  expect(await ticks(page)).toBeGreaterThan(90);
  await page.keyboard.press('Shift+R');
  expect(await ticks(page)).toBeLessThan(30);
  expect(await phase(page)).toBe('playing');
  // and from the pause menu
  await expect.poll(() => ticks(page)).toBeGreaterThan(60);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.keyboard.press('Shift+R');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeHidden();
  expect(await phase(page)).toBe('playing');
  expect(await ticks(page)).toBeLessThan(30);

  // the map maker: it plays the map from the start, and again from the run
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quit to title' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Open the map maker' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await expect(page.locator('.ed')).toBeVisible();
  await expect(page.locator('.ed-help')).toContainText('Your restart key (Shift+R) plays from the start');
  // typing in the name box doesn't trigger it
  await page.getByRole('textbox', { name: 'Name' }).press('Shift+R');
  await expect(page.locator('.ed')).toBeVisible();
  await page.locator('.ed-view').click();
  await page.keyboard.press('Shift+R');
  await expect(page.locator('.ed')).toHaveCount(0);
  await expect.poll(() => phase(page)).toBe('playing');
  await expect.poll(() => ticks(page)).toBeGreaterThan(60);
  await page.keyboard.press('Shift+R');
  expect(await ticks(page)).toBeLessThan(30);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Back to the map maker' })).toBeVisible();
  expect(errors).toEqual([]);
});
