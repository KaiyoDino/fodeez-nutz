import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_IDS, type MapId } from '../src/sim/level';
import { verifyReplay, type Replay } from '../src/sim/replay';
import type { Mode } from '../src/sim/types';
import { findRoute } from './route-finder';

const dir = join(import.meta.dirname, '..', 'src', 'data', 'routes');
const modes: Mode[] = ['original', 'newage'];
// FIND_ROUTE=tower-newage, FIND_ROUTE=crane (both modes), or FIND_ROUTE=all
const find = process.env.FIND_ROUTE ?? '';
const wanted = (map: MapId, mode: Mode) => find === 'all' || find === map || find === `${map}-${mode}`;

describe.skipIf(!find)('route finder (FIND_ROUTE=all | <map> | <map>-<mode>)', () => {
  for (const map of MAP_IDS)
    for (const mode of modes) {
      it.skipIf(!wanted(map, mode))(`finds a winning route on ${map} in ${mode}`, () => {
        const started = Date.now();
        const iterations = Number(process.env.ROUTE_ITERATIONS) || undefined;
        const route = findRoute(map, mode, 1, { log: m => console.log(m), ...(iterations ? { iterations } : {}) });
        console.log(`${map}/${mode}: ${route ? `won in ${route.ticks} ticks (${(route.ticks / 60).toFixed(1)} s of play)` : 'no route found'} after ${((Date.now() - started) / 1000).toFixed(0)} s of searching`);
        expect(route).not.toBeNull();
        writeFileSync(join(dir, `${map}-${mode}.json`), JSON.stringify(route));
      }, 7_200_000);
    }
});

describe('recorded winning routes still win', () => {
  for (const map of MAP_IDS)
    for (const mode of modes) {
      const file = join(dir, `${map}-${mode}.json`);
      it.skipIf(!existsSync(file))(`${map} / ${mode}`, () => {
        const route = JSON.parse(readFileSync(file, 'utf8')) as Replay;
        expect(verifyReplay(route).won).toBe(true);
      });
    }
});
