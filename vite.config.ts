import { defineConfig } from 'vitest/config';
import { editorPlugin } from './tools/editor-plugin.ts';

export default defineConfig({
  base: './',
  plugins: [editorPlugin(import.meta.dirname)],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
