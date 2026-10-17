export type Mode = 'original' | 'newage';

/** A mouse/touch press or release, already converted to world coordinates. */
export interface InputEvent {
  kind: 'press' | 'release';
  x: number;
  y: number;
}

export type Surface = 'girder' | 'spring' | 'goop' | 'mover';

/** Things that happened during a tick, for sound, particles and stats. */
export type SimEvent =
  | { type: 'land'; speed: number; x: number; y: number; surface: Surface }
  | { type: 'bump'; speed: number; x: number; y: number; axis: 'x' | 'y'; surface: Surface }
  | { type: 'spring'; speed: number; x: number; y: number; axis: 'x' | 'y' }
  | { type: 'goopStick'; x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right' }
  | { type: 'goopLetGo'; x: number; y: number }
  | { type: 'goopReset'; x: number; y: number }
  | { type: 'hookFire'; x: number; y: number }
  | { type: 'hookAttach'; x: number; y: number }
  | { type: 'hookCancel'; x: number; y: number; reason: 'blocked' | 'range' | 'spent' | 'released' }
  | { type: 'hookRelease'; x: number; y: number; auto: boolean }
  | { type: 'fall'; distance: number }
  | { type: 'cameos' }
  | { type: 'teleport'; x: number; y: number }
  | { type: 'win' };

export interface Stats {
  ticks: number;
  falls: number;
  biggestFall: number;
  goopResets: number;
  grapples: number;
  bestHeight: number;
}

export interface DudeState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** +1 facing right, -1 facing left (for drawing; physics uses vx). */
  facing: 1 | -1;
}

/** What the renderer needs to know about the hook, whichever mode is running. */
export interface HookView {
  /** idle: in the gun. flying: on its way. attached: stuck to a target. */
  state: 'idle' | 'flying' | 'attached';
  /** Plunger tip position (center), world units. */
  x: number;
  y: number;
}

/** What the renderer and HUD need to know, whichever mode is running. */
export interface DudeView {
  stuck: boolean;
  /** 0..1 how long he has been stuck to goop relative to the 160-tick limit. */
  stuckFor: number;
  /** Which side of the goop he's stuck to. */
  stuckSide: 'top' | 'bottom' | 'left' | 'right' | null;
  airborne: boolean;
  grapplesLeft: number;
}

export const TICK_RATE = 60;
/** Ticks on goop before the goop gives up (Original: back to start; New Age: let go). */
export const GOOP_TICKS = 160;
export const MAX_GRAPPLES = 3;
