// Not a test: captures screenshots of key screens into ./screenshots for eyeballing.
// Run with: npx playwright test --config tools/screens.config.ts
import { test } from '@playwright/test';

const shots: [string, string, { width: number; height: number }][] = [
  ['phone-title', '/', { width: 390, height: 844 }],
  ['phone-play', '/?debug&mode=original&ticks=1&freeze', { width: 390, height: 844 }],
  ['phone-landscape', '/?debug&mode=newage&at=1200,2900&ticks=1&freeze', { width: 844, height: 390 }],
  ['tablet', '/?debug&menu=modes', { width: 820, height: 1180 }],
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
