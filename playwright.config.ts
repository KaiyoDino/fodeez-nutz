import { defineConfig, devices } from '@playwright/test';

// Uses the Edge that's installed on this machine, so no browser download is needed.
// (Swap `channel` for 'chrome' or remove it to use Playwright's own Chromium.)
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    channel: 'msedge',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
  webServer: {
    command: 'npx vite --port 5199 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
