// Not a test: frames and screenshots for eyeballing (flicker, crosshair sizes, zoom, the start screen, settings,
// the level editor) and whole-map overviews. Run with --config tools/screens.config.ts --grep <name>.
import { test } from '@playwright/test';

for (const mode of ['original', 'newage'] as const) {
  test(`flicker-${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/?debug&mode=${mode}&at=1200,1250&freeze`);
    await page.waitForTimeout(600);
    for (let i = 0; i < 4; i++) {
      await page.screenshot({ path: `${import.meta.dirname}/../screenshots/flicker-${mode}-${i}.png` });
      await page.waitForTimeout(37);
    }
  });
}

for (const cursor of ['small', 'medium', 'large'] as const) {
  for (const zoom of ['far', 'normal', 'close'] as const) {
    if (cursor !== 'medium' && zoom !== 'normal') continue;
    test(`cursor-${cursor}-${zoom}`, async ({ page }) => {
      await page.addInitScript(
        ([cursor, zoom]) => localStorage.setItem('fodeez-nutz/v1', JSON.stringify({ v: 2, settings: { cursor, zoom } })),
        [cursor, zoom],
      );
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`/?debug&mode=original&at=830,3750&freeze&pointer=560,180`);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${import.meta.dirname}/../screenshots/cursor-${cursor}-${zoom}.png` });
    });
  }
}

test('gate', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/gate.png` });
});

// Full-map overviews for designing: OVERVIEW=crane:0:3000 (map:y0:y1), default whole crane.
test('overview', async ({ page }) => {
  const [map, y0, y1, mode] = (process.env.OVERVIEW ?? 'crane').split(':');
  const params = new URLSearchParams({ map, mode: mode || 'newage', scale: '0.5' });
  if (y0) params.set('y0', y0);
  if (y1) params.set('y1', y1);
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto(`/tools/overview.html?${params}`);
  await page.waitForFunction(() => document.title === 'ready');
  await page.locator('#c').screenshot({ path: `${import.meta.dirname}/../screenshots/overview-${map}${y0 ? `-${y0}` : ''}.png` });
});

test('editor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.goto('/editor.html?map=tower');
  await page.waitForTimeout(800);
  // select the trapdoor by clicking it
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/editor.png` });
  if (errors.length) throw new Error(errors.join('\n'));
});

test('editor round trip', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.goto('/editor.html?map=tower');
  await page.waitForTimeout(500);
  // the trapdoor is around world (1250, 1075); find its screen spot from the canvas transform
  const box = (await page.locator('#view').boundingBox())!;
  const at = await page.evaluate(() => {
    // fit(): zoom = min(w / (W + 200), h / (H + 200))
    const c = document.getElementById('view')!;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const zoom = Math.min(w / 2200, h / 4100);
    const cx = 1000 - w / 2 / zoom;
    const cy = 1950 - h / 2 / zoom;
    return { x: (1250 - cx) * zoom, y: (1075 - cy) * zoom };
  });
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await page.getByRole('heading', { name: 'Piece 28' }).waitFor();
  await page.keyboard.press('Delete');
  await page.getByText('Click a piece to edit it.').waitFor();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+s');
  await page.getByText('Saved src/sim/maps/tower.ts').waitFor();
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/editor-select.png` });
  if (errors.length) throw new Error(errors.join('\n'));
});

test('settings', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?debug&menu=settings');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${import.meta.dirname}/../screenshots/settings.png` });
});

for (const [name, at] of [['crane-chimney', '760,3940'], ['crane-garden', '430,2300'], ['crane-jib', '1950,900']] as const) {
  test(`ingame-${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/?debug&map=crane&mode=newage&at=${at}&freeze&pointer=500,200`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${import.meta.dirname}/../screenshots/${name}.png` });
  });
}
