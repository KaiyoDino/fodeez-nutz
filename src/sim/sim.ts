import { DUDE, getMap, heightOf, MAPS, type MapDef, type MapId } from './level';
import { applyNewAgeInput, handOf, newNewAgeState, stepNewAge, type NewAgeState } from './newage';
import { applyOriginalInput, HOOK_SIZE, newOriginalState, stepOriginal, type OriginalState } from './original';
import type { DudeState, DudeView, HookView, InputEvent, Mode, SimEvent, Stats } from './types';
import { GOOP_TICKS, MAX_GRAPPLES } from './types';
import { mapOf, newWorld, updateAbove, updateCameos, type WorldState } from './world';

/** v2 added maps (v1 saves are tower runs and are migrated on load). */
export const SAVE_VERSION = 2;
/** A drop bigger than this (world px) counts as a fall in the stats. */
export const FALL_THRESHOLD = 400;

export interface SimState {
  v: number;
  mode: Mode;
  seed: number;
  rng: number;
  dude: DudeState;
  world: WorldState;
  original: OriginalState | null;
  newage: NewAgeState | null;
  stats: Stats;
  /** Highest point (smallest y) since he last stood on something. */
  airPeakY: number;
  won: boolean;
}

export function newSimState(mode: Mode, seed: number, map: MapId = 'tower'): SimState {
  const m = getMap(map);
  const dude: DudeState = { x: m.start.x, y: m.start.y, vx: 0, vy: 0, facing: 1 };
  return {
    v: SAVE_VERSION,
    mode,
    seed,
    rng: seed >>> 0,
    dude,
    world: newWorld(map, mode),
    original: mode === 'original' ? newOriginalState(dude, m.platforms.length) : null,
    newage: mode === 'newage' ? newNewAgeState() : null,
    stats: { ticks: 0, falls: 0, biggestFall: 0, goopResets: 0, grapples: 0, bestHeight: 0 },
    airPeakY: m.start.y,
    won: false,
  };
}

/** Bring a v1 save (tower only, one shared mover flag) up to date. */
function migrate(s: SimState): void {
  if (s.v !== 1) return;
  const w = s.world as WorldState & { map?: MapId };
  w.map = 'tower';
  const o = s.original as (OriginalState & { reversed: boolean | boolean[]; reversedSticky?: boolean }) | null;
  if (o) {
    const flag = o.reversed === true;
    o.reversed = new Array(MAPS.tower.platforms.length).fill(flag);
    o.stuckMover = o.onSticky && o.onMoving ? MAPS.tower.platforms.findIndex(p => p.kind === 'goop' && p.mover) : -1;
    delete o.reversedSticky;
  }
  s.v = SAVE_VERSION;
}

/** Validate a parsed save. Returns null if it isn't a usable state. */
export function loadSimState(raw: unknown): SimState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as SimState;
  if ((s.v !== SAVE_VERSION && s.v !== 1) || (s.mode !== 'original' && s.mode !== 'newage')) return null;
  if (!s.dude || !s.world || !s.stats || !Array.isArray(s.world.platX) || s.world.mode !== s.mode) return null;
  migrate(s);
  if (!(s.world.map in MAPS)) return null;
  // a save from a different version of the map can't be resumed
  const count = MAPS[s.world.map].platforms.length;
  if (s.world.platX.length !== count || s.world.platDx.length !== count) return null;
  if (s.original && (!Array.isArray(s.original.reversed) || s.original.reversed.length !== count)) return null;
  if (s.mode === 'original' && !s.original) return null;
  if (s.mode === 'newage' && !s.newage) return null;
  const nums = [s.dude.x, s.dude.y, s.dude.vx, s.dude.vy];
  if (nums.some(n => typeof n !== 'number' || !Number.isFinite(n))) return null;
  return s;
}

export class Sim {
  state: SimState;

  constructor(state: SimState) {
    this.state = state;
  }

  static create(mode: Mode, seed: number, map: MapId = 'tower'): Sim {
    return new Sim(newSimState(mode, seed, map));
  }

  get mode(): Mode {
    return this.state.mode;
  }

  get mapId(): MapId {
    return this.state.world.map;
  }

  get map(): MapDef {
    return mapOf(this.state.world);
  }

  /** Advance one 1/60 s tick. Inputs are applied first, like the Java mouse handlers firing between timer ticks. */
  step(inputs: readonly InputEvent[] = []): SimEvent[] {
    const s = this.state;
    const events: SimEvent[] = [];
    if (s.won) return events;
    const d = s.dude;

    for (const ev of inputs) {
      if (s.original) applyOriginalInput(d, s.original, ev, events);
      else if (s.newage) applyNewAgeInput(d, s.newage, ev, events);
    }

    updateAbove(s.world, d.y);
    if (updateCameos(s.world, d.x, d.y)) events.push({ type: 'cameos' });

    const result = s.original ? stepOriginal(d, s.original, s.world, s, events) : stepNewAge(d, s.newage!, s.world, events);

    s.stats.ticks++;
    for (const e of events) {
      if (e.type === 'hookAttach') s.stats.grapples++;
      if (e.type === 'goopReset') {
        s.stats.goopResets++;
        s.airPeakY = d.y;
      }
    }
    if (result.landed) {
      const drop = d.y - s.airPeakY;
      if (drop > FALL_THRESHOLD) {
        s.stats.falls++;
        s.stats.biggestFall = Math.max(s.stats.biggestFall, drop);
        events.push({ type: 'fall', distance: drop });
      }
      s.airPeakY = d.y;
    } else {
      s.airPeakY = Math.min(s.airPeakY, d.y);
    }
    s.stats.bestHeight = Math.max(s.stats.bestHeight, heightOf(mapOf(s.world), d.y));

    if (result.won) {
      s.won = true;
      events.push({ type: 'win' });
    }
    return events;
  }

  /** Debug teleport to one of the original's four dev-key spots. */
  teleport(index: number): SimEvent[] {
    const s = this.state;
    const to = mapOf(s.world).teleports[index];
    if (!to || s.won) return [];
    s.dude.x = to.x;
    s.dude.y = to.y;
    s.dude.vx = 0;
    s.dude.vy = 0;
    if (s.original) {
      s.original.onSticky = false;
      s.original.stuckSide = null;
    }
    if (s.newage) {
      s.newage.stuck = null;
      s.newage.hook.state = 'idle';
      s.newage.ground = -1;
    }
    s.airPeakY = to.y;
    return [{ type: 'teleport', x: to.x, y: to.y }];
  }

  hookView(): HookView {
    const s = this.state;
    if (s.original) {
      const o = s.original;
      const state = !o.wantsHook ? 'idle' : o.attached ? 'attached' : 'flying';
      return { state, x: o.hookX + HOOK_SIZE / 2, y: o.hookY + HOOK_SIZE / 2 };
    }
    const h = s.newage!.hook;
    if (h.state === 'idle') {
      const hand = handOf(s.dude);
      return { state: 'idle', x: hand.x, y: hand.y };
    }
    return { state: h.state, x: h.x, y: h.y };
  }

  dudeView(): DudeView {
    const s = this.state;
    if (s.original) {
      const o = s.original;
      const stuck = o.onSticky || o.onGoopTop;
      return {
        stuck,
        stuckFor: o.dying / GOOP_TICKS,
        stuckSide: o.onSticky ? o.stuckSide : o.onGoopTop ? 'top' : null,
        airborne: !o.collidedFloor && !o.onSticky,
        grapplesLeft: Math.max(0, MAX_GRAPPLES - o.grapples),
      };
    }
    const n = s.newage!;
    return {
      stuck: !!n.stuck,
      stuckFor: n.stuck ? n.stuck.ticks / GOOP_TICKS : 0,
      stuckSide: n.stuck?.side ?? null,
      airborne: n.ground < 0 && !n.stuck,
      grapplesLeft: Math.max(0, MAX_GRAPPLES - n.grapples),
    };
  }

  /** Can a press at this world point fire the hook right now? (Original: only 25+ px above him.) */
  canFireAt(x: number, y: number): boolean {
    const s = this.state;
    if (s.won) return false;
    if (s.original) return s.dude.y > y + 25;
    const n = s.newage!;
    const hand = handOf(s.dude);
    return n.hook.state === 'idle' && n.grapples < MAX_GRAPPLES && Math.hypot(x - hand.x, y - hand.y) >= 1;
  }

  center(): { x: number; y: number } {
    return { x: this.state.dude.x + DUDE.w / 2, y: this.state.dude.y + DUDE.h / 2 };
  }
}
