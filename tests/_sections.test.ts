// Dev tool: checks a map one section at a time with the (human-limited) route-finder bot,
// and measures how forgiving each section's route is.
//   SECTIONS=crane-newage npx vitest run tests/_sections.test.ts      (all sections)
//   SECTIONS=crane-newage:3 ...                                       (just section 3)
// Options: ITER (search iterations, default 80), BEAM, VERBOSE=1, SECTIONS_OUT (file),
// TRIALS (blind-replay tries for the forgiveness score, default 40).
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import type { MapId } from '../src/sim/level';
import type { SimState } from '../src/sim/sim';
import type { Mode } from '../src/sim/types';
import { findRoute, forgiveness, PROGRESS } from './route-finder';

export interface Section {
  name: string;
  from: { x: number; y: number; vx?: number };
  done: (s: SimState) => boolean;
  progress: (s: SimState) => number;
}

const standing = (s: SimState) => (s.newage ? s.newage.ground >= 0 || !!s.newage.stuck : s.original!.collidedFloor || s.original!.onSticky);
const up = (s: SimState) => -s.dude.y;

export const SECTIONS: Record<MapId, Section[]> = {
  tower: [
    { name: 'area 1', from: { x: 1000, y: 3750 }, done: s => s.dude.y <= 3000 && s.dude.x > 700 && s.dude.x < 950 && standing(s), progress: up },
    { name: 'area 2', from: { x: 751, y: 3000 }, done: s => s.dude.y <= 1000 && s.dude.x > 900, progress: up },
    { name: 'area 3', from: { x: 1700, y: 1000 }, done: s => s.dude.x < 800 && s.dude.y < 300, progress: s => (s.dude.x < 850 && s.dude.y < 300 ? 5000 : 0) - s.dude.y + (s.dude.y < 450 ? (1500 - s.dude.x) * 0.5 : 0) },
    { name: 'area 4', from: { x: 800, y: 250 }, done: s => s.won, progress: PROGRESS.tower },
  ],
  crane: [
    { name: 'yard', from: { x: 1177, y: 5850 }, done: s => s.dude.y <= 4890 && s.dude.x > 940 && s.dude.x < 1580 && standing(s), progress: up },
    { name: 'mast', from: { x: 1100, y: 4890 }, done: s => s.dude.y <= 3940 && s.dude.x > 540 && s.dude.x < 1020 && standing(s), progress: up },
    { name: 'chimney', from: { x: 760, y: 3940 }, done: s => s.dude.y <= 3050 && s.dude.x > 980 && standing(s), progress: s => -s.dude.y + (s.dude.y < 3300 ? s.dude.x * 0.3 : 0) },
    { name: 'zip line', from: { x: 1200, y: 3050 }, done: s => s.dude.x < 200 && s.dude.y < 2850 && standing(s), progress: s => (s.dude.y < 3060 ? 1500 - s.dude.x : 0) - Math.max(0, s.dude.y - 3060) * 3 },
    { name: 'spring garden', from: { x: 152, y: 2550, vx: -1 }, done: s => s.dude.y <= 900 && s.dude.x > 1780 && standing(s), progress: s => -s.dude.y + s.dude.x * 0.3 },
    { name: 'jib', from: { x: 1950, y: 900 }, done: s => s.won, progress: s => (s.dude.y < 1000 ? 2300 - s.dude.x : 0) - (s.dude.y > 1000 ? 2000 : 0) },
  ],
};

it.skipIf(!process.env.SECTIONS)('sections', () => {
  const [key, only] = process.env.SECTIONS!.split(':');
  const [map, mode] = key.split('-') as [MapId, Mode];
  const out: string[] = [];
  const trials = Number(process.env.TRIALS) || 40;
  SECTIONS[map].forEach((sec, i) => {
    if (only && Number(only) !== i + 1) return;
    const t0 = Date.now();
    const log: string[] = [];
    const r = findRoute(map, mode, 1, {
      startAt: sec.from,
      goal: sec.done,
      progress: sec.progress,
      iterations: Number(process.env.ITER) || 80,
      beam: Number(process.env.BEAM) || 120,
      log: process.env.VERBOSE ? m => log.push(m) : undefined,
    });
    if (log.length) out.push(...log);
    const f = r ? forgiveness(r, trials, { startAt: sec.from, goal: sec.done }) : 0;
    const presses = r ? r.inputs.filter(x => x.kind === 'press').length : 0;
    out.push(`${i + 1}. ${sec.name}: ${r ? `done in ${(r.ticks / 60).toFixed(1)} s of play, ${presses} shots, ${Math.round(f * 100)}% of blind sloppy replays still make it` : 'NOT REACHED'} (${((Date.now() - t0) / 1000).toFixed(0)} s search)`);
    writeFileSync(process.env.SECTIONS_OUT ?? `tests/_sections_${map}-${mode}.txt`, out.join('\n'));
  });
});
