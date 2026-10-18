// Not a test: captures screenshots of key screens into ./screenshots for eyeballing.
// Run with: npx playwright test --config tools/screens.config.ts
import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newDoc } from '../src/sim/custom-map';

const shots: [string, string, { width: number; height: number }][] = [
  ['phone-title', '/', { width: 390, height: 844 }],
  ['phone-play', '/?debug&mode=original&ticks=1&freeze', { width: 390, height: 844 }],
  ['phone-landscape', '/?debug&mode=newage&at=1200,2900&ticks=1&freeze', { width: 844, height: 390 }],
  ['tablet', '/?debug&menu=modes', { width: 820, height: 1180 }],
  ['title-menu', '/?debug', { width: 1280, height: 720 }],
  ['phone-landscape-title', '/?debug', { width: 844, height: 390 }],
];

for (const [name, url, viewport] of shots) {
  test(name, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(url);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${import.meta.dirname}/../screenshots/${name}.png` });
  });
}

// In-motion shots: fire at the first target and catch the rope mid-pull.
for (const mode of ['original', 'newage'] as const) {
  test(`rope-${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/?debug&mode=${mode}&at=830,3750`);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const g = (window as unknown as { __game: { input(e: unknown): void } }).__game;
      g.input({ kind: 'press', x: 862, y: 3462 });
    });
    await page.waitForTimeout(mode === 'original' ? 230 : 420);
    await page.screenshot({ path: `${import.meta.dirname}/../screenshots/rope-${mode}.png` });
  });
}

test('goop-stuck', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?debug&mode=original&at=760,2900');
  await page.evaluate(() => {
    const g = (window as unknown as { __game: { state(): { dude: { vx: number } } } }).__game;
    g.state().dude.vx = -6;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/goop-stuck.png` });
});

// Achievements, wheels and leaderboards (the dev server's in-memory API, with made-up players).
const routeFile = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'data', 'routes', `${name}.json`), 'utf8'));
type Win = { __game: { runRoute(r: unknown): boolean } };

test('achievements', async ({ page }) => {
  await page.goto('/?debug');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  for (const r of ['tower-newage', 'crane-original']) await page.evaluate(route => (window as unknown as Win).__game.runRoute(route), routeFile(r));
  for (const [name, viewport] of [['achievements', { width: 1280, height: 720 }], ['phone-achievements', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    await page.goto('/?debug&menu=achievements');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${import.meta.dirname}/../screenshots/${name}.png`, fullPage: true });
  }
});

test('leaderboards', async ({ page, request }) => {
  const r = routeFile('tower-newage');
  let t = 0;
  const i: number[] = [];
  for (const e of r.inputs) {
    i.push(e.tick - t, e.kind === 'press' ? 0 : 1, e.x, e.y);
    t = e.tick;
  }
  const packed = { v: 1, map: r.map, mode: r.mode, seed: r.seed, ticks: r.ticks, physics: r.physics, mapHash: r.mapHash, i };
  for (const name of ['Kaiyo', 'plungerfan', 'gravity_enjoyer', 'Wheelie Pop', 'xX_noCheckpoints_Xx']) {
    const lid = [...name.padEnd(16, '0')].map(c => (c.charCodeAt(0) % 16).toString(16)).join('').padEnd(32, '0').slice(0, 32);
    await request.post('/api/auth/dev-login', { form: { lid, name } });
    const { token } = await (await request.get(`/api/auth/poll?lid=${lid}`)).json();
    await request.post('/api/submit', { data: packed, headers: { Authorization: `Bearer ${token}` } });
  }
  for (const [name, viewport] of [['leaderboards', { width: 1280, height: 720 }], ['phone-leaderboards', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    await page.goto('/?debug&menu=leaderboards&map=tower');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${import.meta.dirname}/../screenshots/${name}.png` });
  }
});

test('win-online', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?debug');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(route => (window as unknown as Win).__game.runRoute(route), routeFile('crane-newage'));
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/win-online.png` });
});

// The map maker and community maps.
const starterRun = (mode: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'tests', 'fixtures', `starter-${mode}.json`), 'utf8'));
type MapsWin = { __game: { runRoute(r: unknown): boolean; drafts(): { id: string }[] } };

test('map-maker', async ({ page }) => {
  await page.goto('/?debug');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Open the map maker' }).click();
  await page.getByRole('button', { name: 'Copy The Crane' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/editor-ingame.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/phone-editor.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('.ed').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await page.locator('.ed').getByRole('button', { name: 'Done' }).click();
  const drafts = await page.evaluate(() => (window as unknown as MapsWin).__game.drafts());
  await page.evaluate(([r, id]) => (window as unknown as MapsWin).__game.runRoute({ ...r, map: id }), [starterRun('newage'), drafts[0].id] as const);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/win-draft.png` });
  await page.getByRole('button', { name: 'Title' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/choose-map.png` });
  await page.getByRole('button', { name: 'Open the map maker' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/map-maker.png` });
});

test('community', async ({ page, request }) => {
  const token = async (name: string) => {
    const lid = [...name.padEnd(16, '0')].map(c => (c.charCodeAt(0) % 16).toString(16)).join('').padEnd(32, '0').slice(0, 32);
    await request.post('/api/auth/dev-login', { form: { lid, name } });
    return (await (await request.get(`/api/auth/poll?lid=${lid}`)).json()).token as string;
  };
  const maker = await token('Kaiyo');
  const ids: string[] = [];
  for (const [mode, name] of [['newage', 'Plunger Practice'], ['original', 'The Old Way Up']]) {
    const r = starterRun(mode);
    let t = 0;
    const i: number[] = [];
    for (const e of r.inputs) {
      i.push(e.tick - t, e.kind === 'press' ? 0 : 1, e.x, e.y);
      t = e.tick;
    }
    const doc = newDoc(name, mode as 'newage' | 'original');
    const res = await (await request.post('/api/maps/upload', { data: { doc, replay: { v: 1, map: 'draft-x', mode, seed: r.seed, ticks: r.ticks, physics: r.physics, mapHash: r.mapHash, i } }, headers: { Authorization: `Bearer ${maker}` } })).json();
    if (res.map) ids.push(res.map.id);
  }
  for (const [n, stars] of [['ana', 5], ['ben', 4], ['cat', 4]] as const) {
    const tk = await token(n);
    if (ids[0]) await request.post('/api/maps/rate', { data: { id: ids[0], stars }, headers: { Authorization: `Bearer ${tk}` } });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Browse community maps' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/community.png` });
  await page.locator('.map-row').first().getByRole('button', { name: 'Open' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/community-map.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/phone-community-map.png` });
});
