import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import base from '../playwright.config';

const root = join(import.meta.dirname, '..');
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'screens.spec.ts',
  outputDir: join(root, 'test-results'),
  webServer: { ...(base.webServer as object), command: 'npx vite --port 5199 --strictPort --host 127.0.0.1', cwd: root } as never,
});
