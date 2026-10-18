// Builds the game and the leaderboard API for Vercel, in Vercel's Build Output API format:
//   .vercel/output/static/                 the game (the same files as dist/)
//   .vercel/output/functions/api/*.func/   the API (server/vercel.ts bundled with the simulation)
// Vercel runs this as the build command (see vercel.json): npm run build:vercel
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

const root = join(import.meta.dirname, '..');
const out = join(root, '.vercel', 'output');

// The copy of the game Vercel serves talks to the API on its own site.
process.env.VITE_API_URL ??= '/';

execSync('npx tsc --noEmit', { cwd: root, stdio: 'inherit' });
await build({ root, logLevel: 'warn' });

rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'dist'), join(out, 'static'), { recursive: true });

// One bundle for the whole API...
const bundle = join(root, '.vercel', 'api-bundle');
await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: join(root, 'server', 'vercel.ts'),
    outDir: bundle,
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js', exports: 'default' } },
  },
});

// ...copied to each endpoint. (One function per path keeps routing trivial: Vercel maps
// functions/api/board.func to /api/board.) Checking a submitted run can take a while.
const ENDPOINTS = ['health', 'me', 'board', 'replay', 'submit', 'auth/start', 'auth/callback', 'auth/poll', 'auth/logout', 'admin/remove', 'maps', 'maps/get', 'maps/mine', 'maps/upload', 'maps/rate', 'maps/delete'];
for (const path of ENDPOINTS) {
  const dir = join(out, 'functions', 'api', `${path}.func`);
  mkdirSync(dir, { recursive: true });
  cpSync(bundle, dir, { recursive: true });
  const config = { runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', maxDuration: path === 'submit' || path === 'maps/upload' ? 300 : 15 };
  writeFileSync(join(dir, '.vc-config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
}
rmSync(bundle, { recursive: true, force: true });

writeFileSync(join(out, 'config.json'), JSON.stringify({ version: 3 }, null, 2));
console.log(`Vercel output written to ${out}`);
