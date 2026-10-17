import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Mode } from '../src/sim/types';
import { findRoute, replay, type Route } from './route-finder';

const dir = join(import.meta.dirname, 'routes');
const modes: Mode[] = ['original', 'newage'];
const find = process.env.FIND_ROUTE;

describe.skipIf(!find)('route finder (FIND_ROUTE=original|newage|both)', () => {
  for (const mode of modes) {
    it.skipIf(find !== mode && find !== 'both')(`finds a winning route in ${mode}`, () => {
      const started = Date.now();
      const route = findRoute(mode, 1, { log: m => console.log(m) });
      console.log(`${mode}: ${route ? `won in ${route.ticks} ticks (${(route.ticks / 60).toFixed(1)} s of play)` : 'no route found'} after ${((Date.now() - started) / 1000).toFixed(0)} s of searching`);
      expect(route).not.toBeNull();
      writeFileSync(join(dir, `${mode}.json`), JSON.stringify(route));
    }, 3_600_000);
  }
});

describe('recorded winning routes still win', () => {
  for (const mode of modes) {
    const file = join(dir, `${mode}.json`);
    it.skipIf(!existsSync(file))(mode, () => {
      const route = JSON.parse(readFileSync(file, 'utf8')) as Route;
      const result = replay(route);
      expect(result.won).toBe(true);
    });
  }
});
