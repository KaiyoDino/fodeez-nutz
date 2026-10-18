// Not a test: captures screenshots of key screens into ./screenshots for eyeballing.
// Run with: npx playwright test --config tools/screens.config.ts
import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
