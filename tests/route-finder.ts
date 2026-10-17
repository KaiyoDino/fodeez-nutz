// A bot that searches for a winning route through the level, to prove each mode can
// actually be beaten. It's a beam search over "macro" actions: aim at a target, hold
// for N ticks, let go; or just wait N ticks. Progress is height, except in area 4,
// where going down toward the goal room counts as progress.

import { DUDE, LEVEL } from '../src/sim/level';
import { Sim, type SimState } from '../src/sim/sim';
import type { InputEvent, Mode } from '../src/sim/types';
import { isVisible } from '../src/sim/world';

export interface RecordedInput extends InputEvent {
  tick: number;
}

export interface Route {
  mode: Mode;
  seed: number;
  inputs: RecordedInput[];
  ticks: number;
}

interface Node {
  state: SimState;
  inputs: RecordedInput[];
  score: number;
  best: number;
}

export function progress(s: SimState): number {
  if (s.won) return 1e9;
  const { x, y } = s.dude;
  // area 4 only counts once he's properly above the floor (the troll hole lets his head poke up to 1099)
  if (y <= 1000 && x < 850) return 4000 + (y - 100);
  return 3750 - y;
}

const clone = (s: SimState): SimState => structuredClone(s);

function targetsInReach(s: SimState, mode: Mode, reach: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const cx = s.dude.x + DUDE.w / 2;
  const cy = s.dude.y + DUDE.h / 2;
  for (const p of LEVEL) {
    if (p.kind !== 'target' || !isVisible(p, s.world)) continue;
    const tx = p.x + p.w / 2;
    const ty = p.y + p.h / 2;
    if (Math.hypot(tx - cx, ty - cy) > reach) continue;
    if (mode === 'original' && !(s.dude.y > ty + 25)) continue;
    out.push({ x: tx, y: ty });
  }
  return out;
}

interface Options {
  beam: number;
  iterations: number;
  holds: number[];
  waits: number[];
  log?: (msg: string) => void;
}

const DEFAULTS: Record<Mode, Options> = {
  original: { beam: 220, iterations: 140, holds: [2, 4, 7, 10, 14, 19, 25, 200], waits: [3, 10, 25] },
  newage: { beam: 220, iterations: 140, holds: [4, 8, 12, 17, 23, 30, 40, 55, 75], waits: [3, 10, 25] },
};

function simulate(node: Node, mode: Mode, aim: { x: number; y: number } | null, ticks: number): Node {
  const sim = new Sim(clone(node.state));
  const inputs = node.inputs.slice();
  let best = node.best;
  const start = sim.state.stats.ticks;
  if (aim) {
    inputs.push({ tick: start, kind: 'press', x: aim.x, y: aim.y });
    sim.step([{ kind: 'press', x: aim.x, y: aim.y }]);
    let t = 1;
    for (; t < ticks && !sim.state.won; t++) {
      const ev = sim.step();
      best = Math.max(best, progress(sim.state));
      if (ev.some(e => e.type === 'hookCancel' || (e.type === 'hookRelease' && e.auto))) break;
    }
    if (!sim.state.won) {
      inputs.push({ tick: sim.state.stats.ticks, kind: 'release', x: aim.x, y: aim.y });
      sim.step([{ kind: 'release', x: aim.x, y: aim.y }]);
    }
  } else {
    for (let t = 0; t < ticks && !sim.state.won; t++) {
      sim.step();
      best = Math.max(best, progress(sim.state));
    }
  }
  void mode;
  const score = progress(sim.state);
  return { state: sim.state, inputs, score, best: Math.max(best, score) };
}

function bucket(s: SimState): string {
  const d = s.dude;
  const air = s.mode === 'original' ? (s.original!.collidedFloor ? 'g' : s.original!.onSticky ? 's' : 'a') : s.newage!.stuck ? 's' : s.newage!.ground >= 0 ? 'g' : 'a';
  return `${Math.round(d.x / 35)},${Math.round(d.y / 35)},${Math.sign(Math.round(d.vx))},${air}`;
}

export function findRoute(mode: Mode, seed = 1, opts: Partial<Options> = {}): Route | null {
  const o = { ...DEFAULTS[mode], ...opts };
  const root = Sim.create(mode, seed);
  // let him get rolling first
  for (let t = 0; t < 2; t++) root.step();
  let beam: Node[] = [{ state: root.state, inputs: [], score: progress(root.state), best: progress(root.state) }];
  for (let it = 0; it < o.iterations; it++) {
    const children: Node[] = [];
    for (const node of beam) {
      for (const w of o.waits) children.push(simulate(node, mode, null, w));
      for (const aim of targetsInReach(node.state, mode, 420)) for (const h of o.holds) children.push(simulate(node, mode, aim, h));
    }
    const win = children.find(c => c.state.won);
    if (win) return { mode, seed, inputs: win.inputs, ticks: win.state.stats.ticks };
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
      o.log(`${mode} it ${it}: best progress ${top.score.toFixed(0)} at (${top.state.dude.x.toFixed(0)}, ${top.state.dude.y.toFixed(0)}), beam ${beam.length}, ticks ${top.state.stats.ticks}`);
    }
  }
  return null;
}

/** Replay a recorded route and report whether it still wins. */
export function replay(route: Route): { won: boolean; ticks: number; state: SimState } {
  const sim = Sim.create(route.mode, route.seed);
  const byTick = new Map<number, InputEvent[]>();
  for (const i of route.inputs) {
    const list = byTick.get(i.tick) ?? [];
    list.push({ kind: i.kind, x: i.x, y: i.y });
    byTick.set(i.tick, list);
  }
  const last = Math.max(0, ...route.inputs.map(i => i.tick)) + 600;
  while (!sim.state.won && sim.state.stats.ticks < last) sim.step(byTick.get(sim.state.stats.ticks) ?? []);
  return { won: sim.state.won, ticks: sim.state.stats.ticks, state: sim.state };
}
