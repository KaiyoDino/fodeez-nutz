// A bot that searches for a winning route through a map, to prove a map can actually be
// beaten in a given mode. It's a beam search over "macro" actions: aim at a target, hold
// for N ticks, let go; or just wait N ticks. Each map says what counts as progress.
// Winning routes are saved as replays (src/data/routes) that the game can play back.

import { DUDE, type MapId } from '../src/sim/level';
import type { RecordedInput, Replay } from '../src/sim/replay';
import { Sim, type SimState } from '../src/sim/sim';
import type { Mode } from '../src/sim/types';
import { isVisible, len, platformsOf } from '../src/sim/world';

interface Node {
  state: SimState;
  inputs: RecordedInput[];
  score: number;
  best: number;
}

/** How far along a map a state is. Higher is better; a win is huge. */
export const PROGRESS: Record<MapId, (s: SimState) => number> = {
  tower: s => {
    const { x, y } = s.dude;
    // area 4 only counts once he's properly above the floor (the troll hole lets his head poke up to 1099)
    if (y <= 1000 && x < 850) return 4000 + (y - 100);
    return 3750 - y;
  },
  crane: s => {
    const { x, y } = s.dude;
    const h = 5850 - y;
    // the swing line runs left at about y 2600, and the jib runs left at about y 600
    if (y < 1050) return h + (2300 - x) * 0.8;
    if (y < 3100 && y > 2150 && x < 1550) return h + (1550 - x) * 0.6;
    return h;
  },
};

export function progress(s: SimState): number {
  if (s.won) return 1e9;
  return PROGRESS[s.world.map](s);
}

const clone = (s: SimState): SimState => structuredClone(s);

function targetsInReach(s: SimState, mode: Mode, reach: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const cx = s.dude.x + DUDE.w / 2;
  const cy = s.dude.y + DUDE.h / 2;
  const plats = platformsOf(s.world);
  for (let i = 0; i < plats.length; i++) {
    const p = plats[i];
    if (p.kind !== 'target' || !isVisible(p, s.world)) continue;
    const tx = s.world.platX[i] + p.w / 2;
    const ty = p.y + p.h / 2;
    if (len(tx - cx, ty - cy) > reach) continue;
    if (mode === 'original' && !(s.dude.y > ty + 25)) continue;
    out.push({ x: tx, y: ty });
  }
  return out;
}

export interface Options {
  beam: number;
  iterations: number;
  holds: number[];
  waits: number[];
  log?: (msg: string) => void;
  /** Start somewhere other than the map's start (for checking one section at a time). */
  startAt?: { x: number; y: number; vx?: number };
  /** Stop as soon as this is true (for checking one section at a time). */
  goal?: (s: SimState) => boolean;
  /** Override the map's progress measure. */
  progress?: (s: SimState) => number;
}

const DEFAULTS: Record<Mode, Options> = {
  original: { beam: 220, iterations: 220, holds: [2, 4, 7, 10, 14, 19, 25, 200], waits: [3, 10, 25] },
  newage: { beam: 220, iterations: 220, holds: [4, 8, 12, 17, 23, 30, 40, 55, 75], waits: [3, 10, 25] },
};

let progressFn: (s: SimState) => number = progress;
let goalFn: (s: SimState) => boolean = s => s.won;

function simulate(node: Node, aim: { x: number; y: number } | null, ticks: number): Node {
  const sim = new Sim(clone(node.state));
  const inputs = node.inputs.slice();
  let best = node.best;
  const start = sim.state.stats.ticks;
  if (aim) {
    inputs.push({ tick: start, kind: 'press', x: aim.x, y: aim.y });
    sim.step([{ kind: 'press', x: aim.x, y: aim.y }]);
    for (let t = 1; t < ticks && !sim.state.won; t++) {
      const ev = sim.step();
      best = Math.max(best, progressFn(sim.state));
      if (goalFn(sim.state)) break;
      if (ev.some(e => e.type === 'hookCancel' || (e.type === 'hookRelease' && e.auto))) break;
    }
    if (!sim.state.won && !goalFn(sim.state)) {
      inputs.push({ tick: sim.state.stats.ticks, kind: 'release', x: aim.x, y: aim.y });
      sim.step([{ kind: 'release', x: aim.x, y: aim.y }]);
    }
  } else {
    for (let t = 0; t < ticks && !sim.state.won && !goalFn(sim.state); t++) {
      sim.step();
      best = Math.max(best, progressFn(sim.state));
    }
  }
  const score = goalFn(sim.state) ? 1e9 : progressFn(sim.state);
  return { state: sim.state, inputs, score, best: Math.max(best, score) };
}

function bucket(s: SimState): string {
  const d = s.dude;
  const air = s.mode === 'original' ? (s.original!.collidedFloor ? 'g' : s.original!.onSticky ? 's' : 'a') : s.newage!.stuck ? 's' : s.newage!.ground >= 0 ? 'g' : 'a';
  return `${Math.round(d.x / 35)},${Math.round(d.y / 35)},${Math.sign(Math.round(d.vx))},${air}`;
}

export function findRoute(map: MapId, mode: Mode, seed = 1, opts: Partial<Options> = {}): Replay | null {
  const o = { ...DEFAULTS[mode], ...opts };
  progressFn = o.progress ?? progress;
  goalFn = o.goal ?? (s => s.won);
  const root = Sim.create(mode, seed, map);
  if (o.startAt) {
    root.state.dude.x = o.startAt.x;
    root.state.dude.y = o.startAt.y;
    if (o.startAt.vx) {
      root.state.dude.vx = o.startAt.vx;
      root.state.dude.facing = o.startAt.vx > 0 ? 1 : -1;
    }
    root.state.airPeakY = o.startAt.y;
    if (root.state.original) {
      root.state.original.hookX = o.startAt.x + 14;
      root.state.original.hookY = o.startAt.y - 20;
    }
  }
  // let him get rolling first
  for (let t = 0; t < 2; t++) root.step();
  let beam: Node[] = [{ state: root.state, inputs: [], score: progressFn(root.state), best: progressFn(root.state) }];
  for (let it = 0; it < o.iterations; it++) {
    const children: Node[] = [];
    for (const node of beam) {
      for (const w of o.waits) children.push(simulate(node, null, w));
      for (const aim of targetsInReach(node.state, mode, 420)) for (const h of o.holds) children.push(simulate(node, aim, h));
    }
    const win = children.filter(c => goalFn(c.state)).sort((a, b) => a.state.stats.ticks - b.state.stats.ticks)[0];
    if (win) return { v: 1, map, mode, seed, inputs: win.inputs, ticks: win.state.stats.ticks, won: true, by: 'bot', stats: win.state.stats };
    // keep the best node per position bucket, then the best buckets
    const byBucket = new Map<string, Node>();
    for (const c of children) {
      const k = bucket(c.state);
      const prev = byBucket.get(k);
      if (!prev || c.score + c.best * 0.25 > prev.score + prev.best * 0.25) byBucket.set(k, c);
    }
    beam = [...byBucket.values()].sort((a, b) => b.score + b.best * 0.25 - (a.score + a.best * 0.25)).slice(0, o.beam);
    if (o.log && it % 5 === 0) {
      const top = beam[0];
      o.log(`${map}/${mode} it ${it}: best progress ${top.score.toFixed(0)} at (${top.state.dude.x.toFixed(0)}, ${top.state.dude.y.toFixed(0)}), beam ${beam.length}, ticks ${top.state.stats.ticks}`);
    }
  }
  return null;
}
