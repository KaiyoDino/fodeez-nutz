// Dev tool: checks one section of a map at a time with the route-finder bot.
//   SECTIONS=crane-newage npx vitest run tests/_sections.test.ts      (all sections)
//   SECTIONS=crane-newage:3 ...                                       (just section 3)
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import type { SimState } from '../src/sim/sim';
import type { Mode } from '../src/sim/types';
import { findRoute } from './route-finder';

interface Section {
  name: string;
  from: { x: number; y: number; vx?: number };
  done: (s: SimState) => boolean;
  progress: (s: SimState) => number;
}

const standing = (s: SimState) => (s.newage ? s.newage.ground >= 0 || !!s.newage.stuck : s.original!.collidedFloor || s.original!.onSticky);
const up = (s: SimState) => -s.dude.y;

const CRANE: Section[] = [
  { name: 'yard', from: { x: 1177, y: 5850 }, done: s => s.dude.y <= 4650 && s.dude.x > 900 && s.dude.x < 1400 && standing(s), progress: up },
  { name: 'mast', from: { x: 1100, y: 4650 }, done: s => s.dude.y <= 3850 && s.dude.x > 1350 && standing(s), progress: up },
  { name: 'chimney', from: { x: 1600, y: 3850 }, done: s => s.dude.y <= 2990 && s.dude.x < 1500 && standing(s), progress: s => -s.dude.y - (s.dude.y < 3100 ? s.dude.x * 0.5 : 0) },
  { name: 'swing line', from: { x: 1250, y: 2990, vx: -3 }, done: s => s.dude.x < 200 && s.dude.y < 2760 && standing(s), progress: s => -s.dude.x - Math.max(0, s.dude.y - 3000) * 3 },
  { name: 'spring garden', from: { x: 162, y: 2500 }, done: s => s.dude.y <= 1460 && s.dude.x > 1000 && s.dude.x < 1280 && standing(s), progress: up },
  { name: 'to the cab', from: { x: 1100, y: 1450 }, done: s => s.dude.y <= 910 && s.dude.x > 1840 && standing(s), progress: up },
  { name: 'jib', from: { x: 1950, y: 900 }, done: s => s.won, progress: s => (s.dude.y < 1000 ? 2300 - s.dude.x : 0) - (s.dude.y > 1000 ? 2000 : 0) },
];

it.skipIf(!process.env.SECTIONS)('sections', () => {
  const [key, only] = process.env.SECTIONS!.split(':');
  const [map, mode] = key.split('-') as ['crane', Mode];
  const sections = map === 'crane' ? CRANE : [];
  const out: string[] = [];
  sections.forEach((sec, i) => {
    if (only && Number(only) !== i + 1) return;
    const t0 = Date.now();
    const log: string[] = [];
    const r = findRoute(map, mode, 1, { startAt: sec.from, goal: sec.done, progress: sec.progress, iterations: Number(process.env.ITER) || 80, beam: 160, log: process.env.VERBOSE ? m => log.push(m) : undefined });
    if (log.length) out.push(...log);
    const line = `${i + 1}. ${sec.name}: ${r ? `done in ${(r.ticks / 60).toFixed(1)} s of play` : 'NOT REACHED'} (${((Date.now() - t0) / 1000).toFixed(0)} s search)`;
    out.push(line);
    writeFileSync(process.env.SECTIONS_OUT ?? 'tests/_sections.txt', out.join('\n'));
  });
});
