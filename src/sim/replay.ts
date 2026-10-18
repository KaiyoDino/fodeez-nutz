// Replays. The simulation is deterministic, so a run is fully described by its map, mode,
// seed and the inputs it received on each tick. Replaying feeds the same inputs to a fresh
// simulation on the same ticks.

import type { MapDef, MapId } from './map-types';
import { getMap, MAPS } from './maps';
import { Sim, type SimState } from './sim';
import type { InputEvent, Mode, SimEvent, Stats } from './types';

export interface RecordedInput {
  tick: number;
  /** press/release from the mouse, or a debug teleport (x = teleport index). */
  kind: 'press' | 'release' | 'teleport';
  x: number;
  y: number;
}

export interface Replay {
  v: 1;
  map: MapId;
  mode: Mode;
  seed: number;
  inputs: RecordedInput[];
  /** Tick count when the run ended. */
  ticks: number;
  won: boolean;
  by: 'bot' | 'player';
  date?: string;
  stats?: Stats;
  /** The physics it was recorded with (missing on replays from before versions were kept). */
  physics?: number;
  /** Fingerprint of the map's layout when it was recorded (see mapHash). */
  mapHash?: string;
  /** The wheels the player had on (cosmetic only). */
  wheels?: string;
}

/** Bumped whenever a physics change would make old replays play out differently. 2: New Age's pull-and-fling rope. */
export const PHYSICS_VERSION = 2;

/** A short fingerprint of a map's layout (notes left out), so a replay can tell the map was edited since. */
export function mapHash(map: MapDef): string {
  const plats = map.platforms.map(p => [p.kind, p.x, p.y, p.w, p.h, p.mover?.range ?? 0, p.mover?.speed ?? 0, p.role ?? '', p.onlyIn ?? '']);
  const s = JSON.stringify([map.world, map.start, map.goopReset, plats]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Will this replay play back the way it was recorded? (Same physics, same map layout.) */
export function replayIsCurrent(r: Replay): boolean {
  return (r.physics ?? 1) === PHYSICS_VERSION && r.mapHash === mapHash(getMap(r.map));
}

/** Inputs are kept to whole world units so a replay always matches the live run bit for bit. */
export const quantize = (v: number): number => Math.round(v);

/** Steps a fresh simulation through a replay, one tick at a time. */
export class ReplayRunner {
  readonly replay: Replay;
  sim: Sim;
  private byTick = new Map<number, RecordedInput[]>();

  constructor(replay: Replay) {
    this.replay = replay;
    this.sim = Sim.create(replay.mode, replay.seed, replay.map);
    for (const i of replay.inputs) {
      const list = this.byTick.get(i.tick);
      if (list) list.push(i);
      else this.byTick.set(i.tick, [i]);
    }
  }

  get tick(): number {
    return this.sim.state.stats.ticks;
  }

  /** The tick the replay ends on (a little after the last input if the run didn't finish). */
  get end(): number {
    return this.replay.ticks;
  }

  get done(): boolean {
    return this.sim.state.won || this.tick >= this.end;
  }

  /** Inputs that will be applied on the current tick (for drawing clicks). */
  pending(): readonly RecordedInput[] {
    return this.byTick.get(this.tick) ?? [];
  }

  step(): SimEvent[] {
    const list = this.byTick.get(this.tick);
    const events: SimEvent[] = [];
    const inputs: InputEvent[] = [];
    if (list)
      for (const i of list) {
        if (i.kind === 'teleport') events.push(...this.sim.teleport(i.x));
        else inputs.push({ kind: i.kind, x: i.x, y: i.y });
      }
    events.push(...this.sim.step(inputs));
    return events;
  }

  /** Restore a snapshot taken earlier from this same replay (for seeking backwards). */
  restore(state: SimState): void {
    this.sim = new Sim(structuredClone(state));
  }
}

/** Play a replay to the end and report how it finished. */
export function verifyReplay(replay: Replay): { won: boolean; ticks: number; state: SimState } {
  const r = new ReplayRunner(replay);
  while (!r.done) r.step();
  return { won: r.sim.state.won, ticks: r.tick, state: r.sim.state };
}

/** Basic shape check for replays read from storage or files. */
export function isReplay(raw: unknown): raw is Replay {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Replay;
  return r.v === 1 && r.map in MAPS && (r.mode === 'original' || r.mode === 'newage') && typeof r.seed === 'number' && Array.isArray(r.inputs) && typeof r.ticks === 'number';
}

/**
 * The compact form a replay travels in to and from the leaderboard server: the inputs are
 * flattened into one array of [tick delta, kind (0 press, 1 release, 2 teleport), x, y, ...].
 * A long human run is a few thousand inputs, so this keeps it well under a megabyte.
 */
export interface PackedReplay {
  v: 1;
  map: MapId;
  mode: Mode;
  seed: number;
  ticks: number;
  physics: number;
  mapHash: string;
  date?: string;
  wheels?: string;
  /** Filled in by the server from its own replay of the run. */
  stats?: Stats;
  i: number[];
}

const KINDS = ['press', 'release', 'teleport'] as const;

export function packReplay(r: Replay): PackedReplay {
  const i: number[] = [];
  let t = 0;
  for (const e of r.inputs) {
    i.push(e.tick - t, KINDS.indexOf(e.kind), e.x, e.y);
    t = e.tick;
  }
  const p: PackedReplay = { v: 1, map: r.map, mode: r.mode, seed: r.seed, ticks: r.ticks, physics: r.physics ?? 1, mapHash: r.mapHash ?? '', i };
  if (r.date) p.date = r.date;
  if (r.wheels) p.wheels = r.wheels;
  if (r.stats) p.stats = r.stats;
  return p;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Checks the shape of a packed replay (from the network) and expands it. Null if it's malformed. */
export function unpackReplay(raw: unknown, by: Replay['by'] = 'player'): Replay | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as PackedReplay;
  if (p.v !== 1 || !(p.map in MAPS) || (p.mode !== 'original' && p.mode !== 'newage')) return null;
  if (!isInt(p.seed) || !isInt(p.ticks) || p.ticks < 0 || !isInt(p.physics) || typeof p.mapHash !== 'string') return null;
  if (!Array.isArray(p.i) || p.i.length % 4 !== 0) return null;
  const inputs: RecordedInput[] = [];
  let t = 0;
  for (let k = 0; k < p.i.length; k += 4) {
    const [dt, kind, x, y] = [p.i[k], p.i[k + 1], p.i[k + 2], p.i[k + 3]];
    if (!isInt(dt) || dt < 0 || !isInt(kind) || kind < 0 || kind > 2 || !isNum(x) || !isNum(y)) return null;
    t += dt;
    inputs.push({ tick: t, kind: KINDS[kind], x, y });
  }
  const r: Replay = { v: 1, map: p.map, mode: p.mode, seed: p.seed, inputs, ticks: p.ticks, won: true, by, physics: p.physics, mapHash: p.mapHash };
  if (typeof p.date === 'string') r.date = p.date.slice(0, 40);
  if (typeof p.wheels === 'string' && /^[a-z]{1,16}$/.test(p.wheels)) r.wheels = p.wheels;
  if (p.stats && typeof p.stats === 'object' && typeof p.stats.ticks === 'number') r.stats = p.stats;
  return r;
}
