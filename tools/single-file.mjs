// Bundles the built game (dist/) into one self-contained HTML file: dist/fodeez-nutz.html.
// Everything is inlined (script, styles, the latin font files), so it plays by just opening the file.
// Run after `vite build`:  node tools/single-file.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(import.meta.dirname, '..', 'dist');
let html = readFileSync(join(dist, 'index.html'), 'utf8');

const scriptMatch = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/);
const cssMatch = html.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/);
if (!scriptMatch || !cssMatch) throw new Error('could not find the built script/style tags in dist/index.html');

let css = readFileSync(join(dist, cssMatch[1]), 'utf8');
// keep only latin + latin-ext font faces, as woff2 data URIs
css = css.replace(/@font-face\{[^}]*\}/g, face => {
  if (!/latin/.test(face) || /cyrillic|greek|vietnamese/.test(face)) return '';
  const woff2 = face.match(/url\(\.\/([^)]+\.woff2)\)/) ?? face.match(/url\(([^)]+\.woff2)\)/);
  if (!woff2) return '';
  const file = woff2[1].replace(/^\.\//, '').replace(/^\/?assets\//, '');
  const data = readFileSync(join(dist, 'assets', file)).toString('base64');
  return face.replace(/src:[^;}]*/, () => `src:url(data:font/woff2;base64,${data}) format("woff2")`);
});
// a literal "</script" inside the code would end the inline <script> early
const js = readFileSync(join(dist, scriptMatch[1]), 'utf8').replace(/<\/script/gi, () => '<\\/script');
const favicon = readFileSync(join(dist, 'favicon.svg')).toString('base64');

// Function replacements, so `$&`-style patterns inside the minified code are inserted literally.
html = html
  .replace(scriptMatch[0], () => '')
  .replace(cssMatch[0], () => `<style>${css}</style>`)
  .replace(/href="\.\/favicon\.svg"/, () => `href="data:image/svg+xml;base64,${favicon}"`)
  .replace('</body>', () => `<script type="module">${js}</script>\n  </body>`);

writeFileSync(join(dist, 'fodeez-nutz.html'), html);
console.log(`wrote dist/fodeez-nutz.html (${(html.length / 1024).toFixed(0)} KB)`);
