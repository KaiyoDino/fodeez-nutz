// Shared steps for the browser tests.
import { expect, type Page } from '@playwright/test';

/**
 * Stop the game opening real popup windows. (On Windows, a headless browser's popups can leave
 * buttons on the taskbar after the test ends.) The game then shows its "open the sign-in page"
 * link instead, which is what players see when a browser blocks the popup.
 */
export async function blockPopups(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.open = () => null;
  });
}

/** Click "Sign in with itch.io" (unless the sign-in screen is up already) and finish the dev server's sign-in in a separate tab. */
export async function signIn(page: Page, name: string): Promise<void> {
  const screen = page.getByRole('heading', { name: 'Sign in with itch.io' });
  if (!(await screen.isVisible())) await page.getByRole('button', { name: 'Sign in with itch.io' }).first().click();
  await expect(screen).toBeVisible();
  const url = await page.getByRole('link', { name: 'open the sign-in page' }).getAttribute('href');
  const tab = await page.context().newPage();
  await tab.goto(url!);
  await tab.getByRole('textbox', { name: 'Name' }).fill(name);
  await tab.getByRole('button', { name: 'Sign in' }).click();
  await expect(tab.getByRole('heading', { name: 'Signed in' })).toBeVisible();
  await tab.close();
  await expect(page.getByRole('heading', { name: 'Sign in with itch.io' })).toBeHidden({ timeout: 10_000 });
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}
