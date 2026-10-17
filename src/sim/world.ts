import { CAMEO_REVEAL, DUDE, FLOOR_SPLIT_RESET_Y, FLOOR_SPLIT_Y, LEVEL, type PlatformDef } from './level';
import type { Mode } from './types';

/** Mutable per-run state of the level itself. */
export interface WorldState {
  mode: Mode;
  /** Current x of every platform (only movers ever change). */
  platX: number[];
  /** Current horizontal speed of every platform (0 unless it's a mover). */
  platDx: number[];
  /** Whether the dude counts as above the y=1050 floor (drives the trapdoor, plug and troll target). */
  above: boolean;
  /** Whether the area 4 cameos have been revealed. */
  cameos: boolean;
}

export function newWorld(mode: Mode): WorldState {
  return {
    mode,
    platX: LEVEL.map(p => p.x),
    platDx: LEVEL.map(p => p.mover?.speed ?? 0),
    above: false,
    cameos: false,
  };
}

/**
 * The original toggled these the instant the dude's top crossed y=1100, which made the
 * plug flicker every tick while he pushed against it. A small hysteresis band keeps the
 * same outcome without the flicker.
 */
export function updateAbove(world: WorldState, dudeY: number): void {
  if (dudeY < FLOOR_SPLIT_Y) world.above = true;
  else if (dudeY > FLOOR_SPLIT_RESET_Y) world.above = false;
}

/** Returns true the tick the cameos are first revealed. */
export function updateCameos(world: WorldState, x: number, y: number): boolean {
  if (!world.cameos && y < CAMEO_REVEAL.maxY && x < CAMEO_REVEAL.maxX) {
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
  const p = LEVEL[i];
  return { x: world.platX[i], y: p.y, w: p.w, h: p.h };
}

/** Strict overlap, exactly like the original's isColliding. */
export function overlaps(ax: number, ay: number, aw: number, ah: number, b: Box): boolean {
  return ax + aw > b.x && ax < b.x + b.w && ay < b.y + b.h && ay + ah > b.y;
}

export function dudeOverlaps(x: number, y: number, b: Box): boolean {
  return overlaps(x, y, DUDE.w, DUDE.h, b);
}
