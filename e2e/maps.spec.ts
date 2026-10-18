// The map maker and community maps, end to end: make a map, beat it, upload it, then (as
// someone else) find it, rate it and beat it. The dev server runs the API in memory.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockPopups, collectErrors, signIn } from './helpers';

// the bot's run on the map maker's starter map (tests/_starter.test.ts)
const starterRun = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'tests', 'fixtures', 'starter-newage.json'), 'utf8'));

interface GameApi {
  phase(): string;
  runRoute(route: unknown): boolean;
  drafts(): { id: string; name: string; uploaded: string | null }[];
}
const game = (page: Page) => ({
  drafts: () => page.evaluate(() => (window as unknown as { __game: GameApi }).__game.drafts()),
  run: (map: string) => page.evaluate(([r, m]) => (window as unknown as { __game: GameApi }).__game.runRoute({ ...r, map: m }), [starterRun, map] as const),
});

test('make a map, beat it, upload it; someone else rates it and beats it', async ({ page }) => {
  const errors = collectErrors(page);
  await blockPopups(page);
  await page.goto('/?debug');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // the map maker: a new map opens in the editor
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Open the map maker' }).click();
  await expect(page.getByRole('heading', { name: 'Map maker' })).toBeVisible();
  await page.getByRole('button', { name: 'New map' }).click();
  await expect(page.locator('.ed')).toBeVisible();
  const name = page.getByRole('textbox', { name: 'Name' });
  await name.fill('Tiny Tower');
  await expect(page.locator('.ed-draft-status')).toContainText('Not beaten yet');
  // add a piece and take it back out (undo)
  await page.locator('.ed').getByRole('button', { name: 'Girder', exact: true }).click();
  await expect(page.locator('.ed').getByRole('heading', { name: /^Piece \d+$/ })).toBeVisible();
  await page.locator('.ed').getByRole('button', { name: 'Undo' }).click();
  await page.locator('.ed').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.ed')).toHaveCount(0);
  const row = page.locator('.map-row', { hasText: 'Tiny Tower' });
  await expect(row).toContainText('Not beaten yet');
  await expect(row.getByRole('button', { name: 'Upload' })).toHaveCount(0);

  // beat it (the bot's inputs, fed through the real input path)
  const [draft] = await game(page).drafts();
  expect(await game(page).run(draft.id)).toBe(true);
  await expect(page.getByRole('heading', { name: 'YIPPEE!' })).toBeVisible();
  await expect(page.locator('.online-status')).toContainText('You beat your own map');

  // upload from the win screen: signing in first
  await page.getByRole('button', { name: 'Upload it' }).click();
  await signIn(page, 'Maker');
  await expect(page.getByRole('heading', { name: 'YIPPEE!' })).toBeVisible();
  await page.getByRole('button', { name: 'Upload it' }).click();
  await expect(page.locator('.online-status')).toContainText('Uploaded!', { timeout: 15_000 });
  const [uploaded] = await game(page).drafts();
  expect(uploaded.uploaded).toMatch(/^c-/);

  // it's on the community maps, with the creator's time
  await page.getByRole('button', { name: 'Title' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Browse community maps' }).click();
  const listed = page.locator('.map-row', { hasText: 'Tiny Tower' });
  await expect(listed).toContainText('by Maker');
  await expect(listed).toContainText('No ratings · Difficulty unknown');
  await listed.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Tiny Tower' })).toBeVisible();
  await expect(page.locator('.stats')).toContainText('Maker');
  // you can't rate your own map
  await expect(page.getByRole('radiogroup', { name: 'Your rating' })).toHaveCount(0);

  // someone else: sign out, sign in as another player, rate it
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'Climber');
  await expect(page.getByRole('heading', { name: 'Tiny Tower' })).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Your rating' }).getByRole('radio', { name: '4 stars' }).click();
  await expect(page.locator('.stats')).toContainText('4 (1 rating)');

  // and beat it: the time goes on the map's board and counts towards its difficulty
  expect(await game(page).run(uploaded.uploaded!)).toBe(true);
  await expect(page.locator('.online-status')).toContainText(/on the leaderboard/, { timeout: 15_000 });
  await expect(page.getByRole('radiogroup', { name: 'Your rating' })).toBeVisible();
  await page.getByRole('button', { name: 'Title' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Browse community maps' }).click();
  await page.locator('.map-row', { hasText: 'Tiny Tower' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.stats')).toContainText('Easy: other players’ first wins took');
  await page.getByRole('button', { name: 'Leaderboard' }).click();
  await expect(page.locator('.board-row')).toHaveCount(2);
  await expect(page.locator('.board-row.mine')).toContainText('Climber');
  expect(errors).toEqual([]);
});

test('a practice run from the map maker doesn’t count', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Open the map maker' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await page.locator('.ed').getByRole('button', { name: 'Test here' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __game: GameApi }).__game.phase())).toBe('playing');
  await page.keyboard.press('Escape');
  await expect(page.getByText('practice run')).toBeVisible();
  await page.getByRole('button', { name: 'Back to the map maker' }).click();
  await expect(page.locator('.ed')).toBeVisible();
  await expect(page.locator('.ed-draft-status')).toContainText('Not beaten yet');
  expect(errors).toEqual([]);
});
