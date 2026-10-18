// A bot that searches for a winning route through a map, to prove a map can actually be
// beaten in a given mode. It's a beam search over "macro" actions: aim at a target, hold
// for N ticks, let go; or just wait N ticks. Each map says what counts as progress.
// Winning routes are saved as replays (src/data/routes) that the game can play back.
//
// The bot is held to human limits, so a route it finds is one a person could pull off:
//  - after letting go it waits a reaction time before the next press, and every press is
//    held for at least a short moment;
//  - every move must still work if the press comes a little early or late, is held a
//    little longer or shorter, or is aimed a few pixels off. A move that only works when
//    it's frame-perfect is scored by its worst outcome, so the search avoids it.

import { DUDE, getMap, type MapId } from '../src/sim/level';
import { mapHash, PHYSICS_VERSION, type RecordedInput, type Replay } from '../src/sim/replay';
import { Sim, type SimState } from '../src/sim/sim';
import type { Mode } from '../src/sim/types';
import { isVisible, len, platformsOf } from '../src/sim/world';

/** Human limits. Ticks are 1/60 s. */
export const HUMAN = {
  /** From letting go (or the rope letting go) to the next press: reaction time plus moving the mouse. */
  gap: 12,
  /** The shortest press. */
  minHold: 6,
  /** Timing slop every move must survive, in ticks either way. */
  slop: 2,
  /** Hold-length slop every move must survive, in ticks either way. */
  holdSlop: 3,
  /** Aim slop every move must survive, in world px across the aim line. */
  aimSlop: 6,
};

interface Node {
  state: SimState;
  inputs: RecordedInput[];
  score: number;
  best: number;
  /** Earliest tick the next press may come. */
  ready: number;
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
    // up the yard, mast and chimney; then left along the zip line (y 2450-3100); then up the
    // spring garden; then left along the jib (above y 1000, right of the cab back to the hook)
    if (y > 3100) return 5850 - y;
    if (y > 2450) return x < 1550 ? 2750 + (1550 - x) * 0.8 : 5850 - y;
    if (y > 1000) return 3900 + (2450 - y) + x * 0.3;
    return 6000 + (2300 - x);
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
  /** Hold every move to the human slop (default true). */
  robust?: boolean;
}

const DEFAULTS: Record<Mode, Options> = {
  original: { beam: 160, iterations: 220, holds: [6, 9, 13, 18, 24, 32, 200], waits: [4, 10, 25] },
  newage: { beam: 160, iterations: 220, holds: [6, 9, 13, 18, 24, 32, 45, 70], waits: [4, 10, 25] },
};

let progressFn: (s: SimState) => number = progress;
let goalFn: (s: SimState) => boolean = s => s.won;

interface Move {
  aim: { x: number; y: number } | null;
  hold: number;
  /** Extra ticks before the press (on top of the reaction gap). */
  delay: number;
  /** Aim offset across the aim line, in px. */
  across: number;
}

/** The nominal press comes this many ticks after the bot is ready, so "early" has room. */
const LEAD = HUMAN.slop;

function act(node: Node, m: Move): Node {
  const sim = new Sim(clone(node.state));
  const inputs = node.inputs.slice();
  let best = node.best;
  const finish = (ready: number): Node => {
    const score = goalFn(sim.state) ? 1e9 : progressFn(sim.state);
    return { state: sim.state, inputs, score, best: Math.max(best, score), ready };
  };
  if (!m.aim) {
    for (let t = 0; t < m.hold && !sim.state.won && !goalFn(sim.state); t++) {
      sim.step();
      best = Math.max(best, progressFn(sim.state));
    }
    return finish(node.ready);
  }
  const wait = Math.max(0, node.ready - sim.state.stats.ticks) + m.delay;
  for (let t = 0; t < wait; t++) {
    sim.step();
    best = Math.max(best, progressFn(sim.state));
    if (sim.state.won || goalFn(sim.state)) return finish(node.ready);
  }
  let { x, y } = m.aim;
  if (m.across) {
    const dx = x - (sim.state.dude.x + DUDE.w / 2);
    const dy = y - (sim.state.dude.y + DUDE.h / 2);
    const l = len(dx, dy) || 1;
    x = Math.round(x - (dy / l) * m.across);
    y = Math.round(y + (dx / l) * m.across);
  }
  inputs.push({ tick: sim.state.stats.ticks, kind: 'press', x, y });
  sim.step([{ kind: 'press', x, y }]);
  for (let t = 1; t < m.hold && !sim.state.won; t++) {
    const ev = sim.step();
    best = Math.max(best, progressFn(sim.state));
    if (goalFn(sim.state)) break;
    if (ev.some(e => e.type === 'hookCancel' || (e.type === 'hookRelease' && e.auto))) break;
  }
  if (!sim.state.won && !goalFn(sim.state)) {
    inputs.push({ tick: sim.state.stats.ticks, kind: 'release', x, y });
    sim.step([{ kind: 'release', x, y }]);
  }
  return finish(sim.state.stats.ticks + HUMAN.gap);
}

/** The same move done a little worse in every direction a person might get it wrong. */
function sloppy(m: Move): Move[] {
  return [
    { ...m, delay: m.delay - HUMAN.slop, across: HUMAN.aimSlop },
    { ...m, delay: m.delay + HUMAN.slop, across: -HUMAN.aimSlop },
    { ...m, hold: Math.max(HUMAN.minHold, m.hold - HUMAN.holdSlop) },
    { ...m, hold: m.hold + HUMAN.holdSlop },
  ];
}

function bucket(s: SimState): string {
  const d = s.dude;
  const air = s.mode === 'original' ? (s.original!.collidedFloor ? 'g' : s.original!.onSticky ? 's' : 'a') : s.newage!.stuck ? 's' : s.newage!.ground >= 0 ? 'g' : 'a';
  return `${Math.round(d.x / 35)},${Math.round(d.y / 35)},${Math.sign(Math.round(d.vx))},${air}`;
}

/** Make a sim for the start of a search (the map's start, or somewhere else for a section check). */
export function startSim(map: MapId, mode: Mode, seed: number, startAt?: Options['startAt']): Sim {
  const root = Sim.create(mode, seed, map);
  if (startAt) {
    root.state.dude.x = startAt.x;
    root.state.dude.y = startAt.y;
    if (startAt.vx) {
      root.state.dude.vx = startAt.vx;
      root.state.dude.facing = startAt.vx > 0 ? 1 : -1;
    }
    root.state.airPeakY = startAt.y;
    if (root.state.original) {
      root.state.original.hookX = startAt.x + 14;
      root.state.original.hookY = startAt.y - 20;
    }
  }
  // let him get rolling first
  for (let t = 0; t < 2; t++) root.step();
  return root;
}

export function findRoute(map: MapId, mode: Mode, seed = 1, opts: Partial<Options> = {}): Replay | null {
  const o = { ...DEFAULTS[mode], robust: true, ...opts };
  progressFn = o.progress ?? progress;
  goalFn = o.goal ?? (s => s.won);
  const root = startSim(map, mode, seed, o.startAt);
  const p0 = progressFn(root.state);
  let beam: Node[] = [{ state: root.state, inputs: [], score: p0, best: p0, ready: 0 }];
  const rank = (n: Node) => n.score + n.best * 0.25;
  for (let it = 0; it < o.iterations; it++) {
    const children: { node: Node; parent: Node; move: Move }[] = [];
    for (const node of beam) {
      for (const w of o.waits) {
        const move: Move = { aim: null, hold: w, delay: 0, across: 0 };
        children.push({ node: act(node, move), parent: node, move });
      }
      for (const aim of targetsInReach(node.state, mode, 420))
        for (const h of o.holds) {
          const move: Move = { aim, hold: h, delay: LEAD, across: 0 };
          children.push({ node: act(node, move), parent: node, move });
        }
    }
    // Score the most promising moves by their worst sloppy version too.
    children.sort((a, b) => rank(b.node) - rank(a.node));
    const top = children.slice(0, Math.ceil(o.beam * 1.5));
    if (o.robust) {
      for (const c of top) {
        if (!c.move.aim) continue;
        for (const v of sloppy(c.move)) {
          const r = act(c.parent, v);
          if (r.score < c.node.score) c.node.score = r.score;
          if (r.best < c.node.best) c.node.best = r.best;
        }
      }
    }
    const win = top.filter(c => c.node.score >= 1e9).sort((a, b) => a.node.state.stats.ticks - b.node.state.stats.ticks)[0];
    if (win) return { v: 1, map, mode, seed, inputs: win.node.inputs, ticks: win.node.state.stats.ticks, won: true, by: 'bot', stats: win.node.state.stats, physics: PHYSICS_VERSION, mapHash: mapHash(getMap(map)) };
    // keep the best node per position bucket, then the best buckets
    const byBucket = new Map<string, Node>();
    for (const { node } of top) {
      const k = bucket(node.state);
      const prev = byBucket.get(k);
      if (!prev || rank(node) > rank(prev)) byBucket.set(k, node);
    }
    beam = [...byBucket.values()].sort((a, b) => rank(b) - rank(a)).slice(0, o.beam);
    if (o.log && it % 5 === 0) {
      const t = beam[0];
      o.log(`${map}/${mode} it ${it}: best progress ${t.score.toFixed(0)} at (${t.state.dude.x.toFixed(0)}, ${t.state.dude.y.toFixed(0)}), beam ${beam.length}, ticks ${t.state.stats.ticks}`);
    }
  }
  return null;
}

/**
 * How forgiving a route is when played back blind: every press and release is moved by up
 * to `slop` ticks and every aim by up to `aimSlop` px, at random, and the route is replayed
 * without adjusting. Returns the share of tries that still reach the goal. (A person adjusts
 * as they go, so this is a pessimistic measure, but it ranks sections by how tight they are.)
 */
export function forgiveness(route: Replay, trials: number, opts: { startAt?: Options['startAt']; goal?: (s: SimState) => boolean; slop?: number; aimSlop?: number } = {}): number {
  const goal = opts.goal ?? ((s: SimState) => s.won);
  const slop = opts.slop ?? HUMAN.slop;
  const aimSlop = opts.aimSlop ?? HUMAN.aimSlop;
  let rng = 12345;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) >>> 0;
    return rng / 2 ** 32;
  };
  const int = (k: number) => Math.round((rand() * 2 - 1) * k);
  let ok = 0;
  for (let t = 0; t < trials; t++) {
    const sim = startSim(route.map, route.mode, route.seed, opts.startAt);
    const moved: RecordedInput[] = [];
    let last = sim.state.stats.ticks;
    for (const inp of route.inputs) {
      const ax = inp.kind === 'press' ? int(aimSlop) : 0;
      const ay = inp.kind === 'press' ? int(aimSlop) : 0;
      const tick = Math.max(inp.tick + int(slop), last + 1);
      moved.push({ ...inp, tick, x: inp.x + ax, y: inp.y + ay });
      last = tick;
    }
    const byTick = new Map<number, RecordedInput[]>();
    for (const i of moved) byTick.set(i.tick, [...(byTick.get(i.tick) ?? []), i]);
    const end = route.ticks + 120;
    while (sim.state.stats.ticks < end && !goal(sim.state)) {
      const now = byTick.get(sim.state.stats.ticks) ?? [];
      sim.step(now.filter(i => i.kind !== 'teleport').map(i => ({ kind: i.kind as 'press' | 'release', x: i.x, y: i.y })));
    }
    if (goal(sim.state)) ok++;
  }
  return ok / trials;
}
