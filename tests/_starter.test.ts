import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { docToMap, newDoc } from '../src/sim/custom-map';
import { registerMap } from '../src/sim/level';
import { findRoute } from './route-finder';

// STARTER=1 npx vitest run tests/_starter.test.ts: the bot beats the map maker's starter map in
// both modes and saves the runs to tests/fixtures/ (used by the server and browser tests).
it.skipIf(!process.env.STARTER)('finds routes on the starter map', () => {
  for (const mode of ['newage', 'original'] as const) {
    registerMap(docToMap('draft-starter', newDoc('Starter', mode)));
    const r = findRoute('draft-starter', mode, 1, { iterations: 60, progress: s => (s.won ? 1e9 : 2000 - s.dude.y) });
    if (!r) throw new Error(`no route in ${mode}`);
    writeFileSync(join(import.meta.dirname, 'fixtures', `starter-${mode}.json`), JSON.stringify({ ...r, by: 'player' }));
  }
}, 600_000);
