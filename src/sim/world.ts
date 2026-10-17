import { DUDE, getMap, type MapDef, type MapId, type PlatformDef } from './level';
import type { Mode } from './types';

/** Mutable per-run state of the level itself. */
export interface WorldState {
  map: MapId;
  mode: Mode;
  /** Current x of every platform (only movers ever change). */
  platX: number[];
  /** Current horizontal speed of every platform (0 unless it's a mover). */
  platDx: number[];
  /** Whether the dude counts as above the map's split floor (drives the trapdoor, plug and troll target). */
  above: boolean;
  /** Whether the cameos have been revealed. */
  cameos: boolean;
}

export function newWorld(map: MapId, mode: Mode): WorldState {
  const m = getMap(map);
  return {
    map,
    mode,
    platX: m.platforms.map(p => p.x),
    platDx: m.platforms.map(p => p.mover?.speed ?? 0),
    above: false,
    cameos: false,
  };
}

export const mapOf = (world: Pick<WorldState, 'map'>): MapDef => getMap(world.map);
export const platformsOf = (world: Pick<WorldState, 'map'>): readonly PlatformDef[] => getMap(world.map).platforms;

/**
 * The original toggled the tricks the instant the dude's top crossed the split line, which
 * made the plug flicker every tick while he pushed against it. A small hysteresis band
 * keeps the same outcome without the flicker.
 */
export function updateAbove(world: WorldState, dudeY: number): void {
  const split = mapOf(world).split;
  if (!split) return;
  if (dudeY < split.y) world.above = true;
  else if (dudeY > split.resetY) world.above = false;
}

/** Returns true the tick the cameos are first revealed. */
export function updateCameos(world: WorldState, x: number, y: number): boolean {
  const reveal = mapOf(world).cameoReveal;
  if (!reveal || world.cameos) return false;
  if (y < reveal.maxY && x < reveal.maxX) {
    world.cameos = true;
    return true;
  }
  return false;
}

/** Does this platform exist right now? (Map tricks and mode-only platforms come and go.) */
export function isVisible(def: PlatformDef, world: Pick<WorldState, 'above' | 'mode'>): boolean {
  if (def.onlyIn && def.onlyIn !== world.mode) return false;
  switch (def.role) {
    case 'trapdoor':
    case 'troll':
      return !world.above;
    case 'plug':
      return world.above;
    default:
      return true;
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function platformBox(world: WorldState, i: number): Box {
  const p = platformsOf(world)[i];
  return { x: world.platX[i], y: p.y, w: p.w, h: p.h };
}

/** Strict overlap, exactly like the original's isColliding. */
export function overlaps(ax: number, ay: number, aw: number, ah: number, b: Box): boolean {
  return ax + aw > b.x && ax < b.x + b.w && ay < b.y + b.h && ay + ah > b.y;
}

export function dudeOverlaps(x: number, y: number, b: Box): boolean {
  return overlaps(x, y, DUDE.w, DUDE.h, b);
}

/** sqrt-based length, identical in every JS engine (Math.hypot can differ in the last bit). */
export const len = (x: number, y: number): number => Math.sqrt(x * x + y * y);
