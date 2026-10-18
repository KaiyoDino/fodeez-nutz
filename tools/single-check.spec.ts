// Checks dist/fodeez-nutz.html (from `npm run build:single`) runs straight from disk without errors.
// Run with: npx playwright test --config tools/screens.config.ts --grep single
import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

test('single-file build runs from disk', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto(pathToFileURL(join(import.meta.dirname, '..', 'dist', 'fodeez-nutz.html')).href);
  // the start screen (browsers want a click before sound), unless autoplay is allowed
  const gate = page.getByRole('button', { name: 'Click to start' });
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(gate.or(play)).toBeVisible();
  if (await gate.isVisible()) await gate.click();
  await expect(play).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  await page.screenshot({ path: join(import.meta.dirname, '..', 'screenshots', 'single-file.png') });
});
