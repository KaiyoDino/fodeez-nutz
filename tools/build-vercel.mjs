// Builds the game and the leaderboard API for Vercel, in Vercel's Build Output API format:
//   .vercel/output/static/                 the game (the same files as dist/)
//   .vercel/output/functions/api.func/     the API (server/vercel.ts bundled with the simulation),
//                                          one function for every /api/* path
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

// ...as a single function. The Hobby plan allows at most 12 functions per deployment, so
// every /api/* path is rewritten to this one (the route goes along as __route, and
// server/vercel.ts puts it back). Checking a submitted run or an uploaded map can take a
// while, hence the long limit; other requests finish in well under a second.
const dir = join(out, 'functions', 'api.func');
mkdirSync(dir, { recursive: true });
cpSync(bundle, dir, { recursive: true });
writeFileSync(join(dir, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', maxDuration: 300 }, null, 2));
writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
rmSync(bundle, { recursive: true, force: true });

const config = {
  version: 3,
  routes: [{ src: '^/api/(.+)$', dest: '/api?__route=$1' }],
};
writeFileSync(join(out, 'config.json'), JSON.stringify(config, null, 2));
console.log(`Vercel output written to ${out}`);
