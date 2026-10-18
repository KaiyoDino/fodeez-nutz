// Dev tool: how forgiving is each designed move? For a move "from ledge A, shoot target T
// (then maybe U), land on ledge B", it rolls the dude back and forth on A and tries firing on
// every tick, holding until the rope lets go, then lets him fly. It reports the timing
// windows (in ms) in which the shot works. Wider is easier: about 150 ms is comfortable,
// under 50 ms is hard. Multi-shot moves sweep the delay before each later shot too.
//   MOVES=crane-newage npx vitest run tests/_moves.test.ts
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { DUDE, getMap, type MapId } from '../src/sim/level';
import { NA } from '../src/sim/newage';
import { Sim, type SimState } from '../src/sim/sim';
import type { Mode, SimEvent } from '../src/sim/types';

export interface MoveDef {
  name: string;
  /** Platform index he starts on. */
  from: number;
  /** Target indices, shot in order. */
  shots: number[];
  /** Platform indices that count as a successful landing (goop he sticks to, or a spring he bounces on). */
  land: number[];
  /** Longest delay to try before a follow-up shot, in ticks after the reaction gap (default 40). */
  maxDelay?: number;
}

export const MOVES: Partial<Record<MapId, MoveDef[]>> = {
  crane: [
    { name: 'yard 1: floor to ledge', from: 0, shots: [4], land: [5] },
    { name: 'yard 2', from: 5, shots: [7], land: [8] },
    { name: 'yard 3', from: 8, shots: [9], land: [10] },
    { name: 'yard 4: to the mast', from: 10, shots: [11], land: [12] },
    { name: 'mast 1: chain two', from: 12, shots: [15, 16], land: [17] },
    { name: 'mast 2', from: 17, shots: [19], land: [20] },
    { name: 'mast 3', from: 20, shots: [21], land: [22] },
    { name: 'chimney 1: in', from: 22, shots: [27], land: [25] },
    { name: 'chimney 2', from: 25, shots: [28], land: [26] },
    { name: 'chimney 3', from: 26, shots: [29], land: [25] },
    { name: 'chimney 4: out', from: 25, shots: [30], land: [31] },
    { name: 'zip line', from: 31, shots: [33, 34, 35], land: [36] },
    { name: 'garden 1: onto the first pad', from: 36, shots: [37], land: [38] },
    { name: 'garden 2: up to the second pad', from: 38, shots: [39], land: [40] },
    { name: 'garden 3: up to the third pad', from: 40, shots: [41], land: [42] },
    { name: 'garden 4: to the cab', from: 42, shots: [43], land: [44, 45] },
    { name: 'jib 1: from the cab', from: 44, shots: [47], land: [48] },
    { name: 'jib 2: across the gap', from: 48, shots: [49, 50], land: [51] },
    { name: 'jib 3: the hook', from: 51, shots: [52], land: [-3] },
  ],
};

const TICK_MS = 1000 / 60;

/** Where is he resting, if anywhere? (platform index, or -1) */
function restingOn(s: SimState): number {
  if (s.newage) return s.newage.stuck ? s.newage.stuck.i : s.newage.ground;
  const o = s.original!;
  if (!o.collidedFloor && !o.onSticky) return -1;
  const plats = s.world.platX;
  const L = getMap(s.world.map).platforms;
  for (let i = 0; i < L.length; i++) {
    const p = L[i];
    const x = plats[i];
    if (s.dude.x + DUDE.w > x && s.dude.x < x + p.w && Math.abs(s.dude.y + DUDE.h - p.y) < 2) return i;
  }
  return -1;
}

const centre = (map: MapId, i: number) => {
  const p = getMap(map).platforms[i];
  return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
};

/** Outcome codes for a shot that never caught. */
const CANCEL: Record<string, number> = { range: -10, blocked: -11, spent: -12, released: -13 };

/** Which spring (if any) a spring event came from. */
function springAt(map: MapId, ev: SimEvent[]): number {
  const L = getMap(map).platforms;
  for (const e of ev) {
    if (e.type !== 'spring' || e.axis !== 'y') continue;
    const i = L.findIndex(p => p.kind === 'spring' && e.x >= p.x - 30 && e.x <= p.x + p.w + 30 && Math.abs(e.y - p.y) < 30);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Fire at each target in turn (after `delays[k]` ticks for k >= 1), hold until the rope lets
 * go, then fly until he rests (or bounces on one of the springs in `bounce`).
 */
function attempt(start: SimState, map: MapId, shots: number[], delays: number[], bounce: number[] = [], path?: string[]): { landed: number; state: SimState } {
  const sim = new Sim(structuredClone(start));
  if (path) {
    const step = sim.step.bind(sim);
    let n = 0;
    sim.step = (inputs = []) => {
      const ev = step(inputs);
      if (n++ % 6 === 0 || inputs.length) path.push(`${inputs.length ? inputs[0].kind[0] : ''}(${sim.state.dude.x.toFixed(0)},${sim.state.dude.y.toFixed(0)})`);
      return ev;
    };
  }
  for (let k = 0; k < shots.length; k++) {
    if (k > 0) for (let t = 0; t < delays[k]; t++) sim.step();
    const c = centre(map, shots[k]);
    let ev = sim.step([{ kind: 'press', x: c.x, y: c.y }]);
    let t = 0;
    for (; t < 150; t++) {
      if (ev.some(e => e.type === 'hookCancel' || (e.type === 'hookRelease' && e.auto))) break;
      ev = sim.step();
    }
    sim.step([{ kind: 'release', x: c.x, y: c.y }]);
    const cancel = ev.find(e => e.type === 'hookCancel');
    if (cancel && cancel.type === 'hookCancel') return { landed: CANCEL[cancel.reason], state: sim.state };
  }
  // fly until he rests somewhere (or falls a long way)
  for (let t = 0; t < 400; t++) {
    const ev = sim.step();
    if (sim.state.won) return { landed: -3, state: sim.state };
    const sp = springAt(map, ev);
    if (sp >= 0 && bounce.includes(sp)) return { landed: sp, state: sim.state };
    const r = restingOn(sim.state);
    if (r >= 0 && t > 3) return { landed: r, state: sim.state };
  }
  return { landed: -1, state: sim.state };
}

/** Did this state just come off this spring? (He's right above it, going up.) */
function springLanding(s: SimState, p: { x: number; y: number; w: number }): boolean {
  return s.dude.vy < 0 && s.dude.x + DUDE.w > p.x && s.dude.x < p.x + p.w && Math.abs(s.dude.y + DUDE.h - p.y) < 40;
}

/** Contiguous runs of true in a list of booleans, as lengths. */
function runs(ok: boolean[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const v of ok) {
    if (v) n++;
    else if (n) {
      out.push(n);
      n = 0;
    }
  }
  if (n) out.push(n);
  return out;
}

/** Human reaction time before a follow-up shot (ticks). */
const GAP = 12;

it.skipIf(!process.env.MOVES)('moves', () => {
  const [map, mode] = process.env.MOVES!.split('-') as [MapId, Mode];
  const moves = MOVES[map] ?? [];
  const out: string[] = [];
  const L = getMap(map).platforms;
  /** Where the last move that ended on each platform left him (the middle of its widest window). */
  const arrivals = new Map<number, SimState>();
  for (const mv of moves) {
    const p = L[mv.from];
    let sim: Sim;
    const arrived = arrivals.get(mv.from);
    if ((p.kind === 'goop' || p.kind === 'spring') && arrived) {
      // stuck where the previous move put him
      sim = new Sim(structuredClone(arrived));
    } else {
      // start at the left end of the ledge rolling right (on the floor: start near the spawn)
      sim = Sim.create(mode, 1, map);
      const startX = mv.from === 0 ? getMap(map).start.x : p.x + 25;
      sim.state.dude.x = startX;
      sim.state.dude.y = p.y - DUDE.h;
      sim.state.dude.vx = mode === 'newage' ? NA.cruise : 3;
      sim.state.dude.facing = 1;
      sim.state.airPeakY = sim.state.dude.y;
      if (sim.state.original) {
        sim.state.original.hookX = startX + 14;
        sim.state.original.hookY = sim.state.dude.y - 20;
      }
    }
    const rolled: SimState[] = [];
    const springy = p.kind === 'spring';
    for (let t = 0; t < (springy ? 120 : 300); t++) {
      if (!springy && restingOn(sim.state) !== mv.from && t > 2) break; // rolled off, or the goop let go
      rolled.push(structuredClone(sim.state));
      sim.step();
    }
    const bounce = mv.land.filter(i => i >= 0 && L[i].kind === 'spring');
    if (process.env.VERBOSE) {
      const c = centre(map, mv.shots[0]);
      let best = { d: Infinity, x: 0, y: 0, t: 0 };
      rolled.forEach((st, t) => {
        const d = Math.hypot(st.dude.x + NA.hand.x - c.x, st.dude.y + NA.hand.y - c.y);
        if (d < best.d) best = { d, x: st.dude.x, y: st.dude.y, t };
      });
      out.push(`   (closest to the first target: ${best.d.toFixed(0)} px, with him at ${best.x.toFixed(0)}, ${best.y.toFixed(0)} on tick ${best.t})`);
    }
    const evaluate = (every = 1) => {
      const firstOk: boolean[] = [];
      const bestLater: number[] = [];
      const outcomes = new Map<number, number>();
      const landings: (SimState | null)[] = [];
      for (const [n, st] of rolled.entries()) {
        if (n % every) continue;
        if (mv.shots.length === 1) {
          const r = attempt(st, map, mv.shots, [], bounce);
          outcomes.set(r.landed, (outcomes.get(r.landed) ?? 0) + 1);
          const ok = mv.land.includes(r.landed);
          firstOk.push(ok);
          landings.push(ok ? r.state : null);
          continue;
        }
        // multi-shot: sweep the delay before the later shot(s) (same delay for each), keep the widest window
        const okDelays: boolean[] = [];
        let landing: SimState | null = null;
        for (let d = GAP; d <= GAP + (mv.maxDelay ?? 40); d++) {
          const r = attempt(st, map, mv.shots, mv.shots.map(() => d), bounce);
          const ok = mv.land.includes(r.landed);
          okDelays.push(ok);
          if (ok && !landing) landing = r.state;
        }
        const w = Math.max(0, ...runs(okDelays));
        firstOk.push(w > 0);
        bestLater.push(w);
        landings.push(landing);
      }
      return { firstOk, bestLater, outcomes, landings };
    };
    if (process.env.TUNE && mv.name.startsWith(process.env.TUNE)) {
      // try the chosen shot's target all around its current spot; report the best spots
      const k = Number(process.env.TUNE_SHOT ?? 0);
      const i = mv.shots[k];
      const R = Number(process.env.TUNE_R ?? 150);
      const S = Number(process.env.TUNE_STEP ?? 25);
      const def = L[i] as { x: number; y: number };
      const home = { x: def.x, y: def.y };
      const results: { x: number; y: number; widest: number; share: number }[] = [];
      for (let dx = -R; dx <= R; dx += S)
        for (let dy = -R; dy <= R; dy += S) {
          def.x = home.x + dx;
          def.y = home.y + dy;
          for (const st of rolled) st.world.platX[i] = def.x;
          const every = Number(process.env.TUNE_EVERY ?? 1);
          const e = evaluate(every);
          const widest = Math.max(0, ...runs(e.firstOk)) * every;
          results.push({ x: def.x, y: def.y, widest, share: e.firstOk.filter(Boolean).length / Math.max(1, e.firstOk.length) });
        }
      def.x = home.x;
      def.y = home.y;
      for (const st of rolled) st.world.platX[i] = def.x;
      results.sort((a, b) => b.widest - a.widest || b.share - a.share);
      out.push(`   TUNE ${mv.name}, shot ${k} (target ${i} now at ${home.x}, ${home.y}):`);
      for (const r of results.slice(0, 10)) out.push(`     t(${r.x}, ${r.y}): widest ${Math.round(r.widest * TICK_MS)} ms, ${Math.round(r.share * 100)}%`);
      writeFileSync(`tests/_moves_${map}-${mode}.txt`, out.join('\n'));
    }
    const { firstOk, bestLater, outcomes, landings } = evaluate();
    if (process.env.PATHS) {
      // sample paths: firing at a quarter, half and three quarters of the way through
      for (const f of [0.25, 0.5, 0.75]) {
        const k = Math.floor(rolled.length * f);
        const path: string[] = [];
        const res = attempt(rolled[k], map, mv.shots, mv.shots.map(() => GAP + 8), bounce, path);
        out.push(`   path firing on tick ${k} -> ${res.landed}: ${path.slice(0, 40).join(' ')}`);
      }
    }
    const r = runs(firstOk);
    const widest = Math.max(0, ...r);
    // remember where a typical success leaves him: the middle of the widest window
    let end = -1;
    for (let i = 0, n = 0; i < firstOk.length; i++) {
      n = firstOk[i] ? n + 1 : 0;
      if (n === widest && widest > 0) end = i;
    }
    if (end >= 0) {
      const mid = landings[end - Math.floor(widest / 2)];
      if (mid) arrivals.set(mv.land.find(i => i >= 0 && L[i].kind === 'spring' && springLanding(mid, L[i])) ?? restingOn(mid), mid);
      if (mid && process.env.VERBOSE) out.push(`   (a typical success leaves him at ${mid.dude.x.toFixed(0)}, ${mid.dude.y.toFixed(0)})`);
    }
    const share = firstOk.filter(Boolean).length / Math.max(1, firstOk.length);
    let line = `${mv.name}: widest firing window ${Math.round(widest * TICK_MS)} ms, works on ${Math.round(share * 100)}% of the ${firstOk.length} ticks he's there (${r.length} windows)`;
    if (mv.shots.length > 1) line += `; best follow-up window ${Math.round(Math.max(0, ...bestLater) * TICK_MS)} ms`;
    if (process.env.VERBOSE) line += `\n   landed on: ${[...outcomes].map(([k, v]) => `${k}x${v}`).join(' ')}`;
    out.push(line);
    writeFileSync(`tests/_moves_${map}-${mode}.txt`, out.join('\n'));
  }
}, 3_600_000);
