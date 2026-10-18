// Shared vocabulary for maps: platform kinds, map definitions, and small constructors.

import type { Mode } from './types';

/** The maps that ship with the game. */
export type BuiltinMapId = 'tower' | 'crane';
/** A built-in map, a player's draft ("draft-..."), or a community map ("c-..."). */
export type MapId = string;

export type PlatformKind = 'girder' | 'spring' | 'goop' | 'target' | 'goal';

/**
 * Map tricks that depend on which side of a "split" floor the dude is on (the tower's y=1050 floor).
 * - trapdoor: solid from below, gone once you're above it
 * - plug: fills a hole once you're above the floor
 * - troll: a target you can see (and hook) through that hole from below
 */
export type PlatformRole = 'trapdoor' | 'plug' | 'troll';

export interface PlatformDef {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: PlatformKind;
  /** Horizontal ping-pong motion: travels `range` px to the right of x at `speed` px/tick. */
  mover?: { range: number; speed: number };
  role?: PlatformRole;
  /** Only exists in one mode. */
  onlyIn?: Mode;
  /** Which area of the map it belongs to. */
  area: number;
  /** A comment for map editors (shown in the level editor, kept when it saves). */
  note?: string;
}

export interface Cameo {
  id: 'cauldron' | 'king' | 'pogo';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  tagline: string;
  /** The physics the map was designed around. */
  designedFor: Mode;
  world: { w: number; h: number };
  start: { x: number; y: number };
  /** Where Original's goop timer sends you. */
  goopReset: { x: number; y: number };
  /** Debug teleports (keys 1-9). */
  teleports: readonly { x: number; y: number }[];
  /** In collision order. Original mode resolves collisions in list order, like the Java game. */
  platforms: readonly PlatformDef[];
  /** A floor that splits the map for the trapdoor/plug/troll tricks: "above" once the dude's top passes y. */
  split?: { y: number; resetY: number };
  cameos?: readonly Cameo[];
  /** The cameos appear once the dude is above maxY and left of maxX. */
  cameoReveal?: { maxX: number; maxY: number };
  /** Sky: the tower climbs from sunset into night; the crane climbs from night into dawn. */
  theme: 'sunset' | 'dawn';
  /** World units per meter for the HUD. */
  metersPer: number;
  /** Names of the map's areas, by area number (for the level editor and the map file's comments). */
  areas?: readonly string[];
}

/** The dude's hitbox, unchanged from the original. */
export const DUDE = { w: 46, h: 50 } as const;

export const girder = (x: number, y: number, w: number, h: number, area: number, extra: Partial<PlatformDef> = {}): PlatformDef => ({ x, y, w, h, kind: 'girder', area, ...extra });
export const target = (x: number, y: number, area: number, extra: Partial<PlatformDef> = {}): PlatformDef => ({ x, y, w: 25, h: 25, kind: 'target', area, ...extra });
export const goop = (x: number, y: number, w: number, h: number, area: number, extra: Partial<PlatformDef> = {}): PlatformDef => ({ x, y, w, h, kind: 'goop', area, ...extra });
export const spring = (x: number, y: number, w: number, h: number, area: number, extra: Partial<PlatformDef> = {}): PlatformDef => ({ x, y, w, h, kind: 'spring', area, ...extra });
export const goal = (x: number, y: number, w: number, h: number, area: number, extra: Partial<PlatformDef> = {}): PlatformDef => ({ x, y, w, h, kind: 'goal', area, ...extra });

/** Height above the map's floor (its bottom 100 px), in world px, of a dude whose top-left is at y. */
export const heightOf = (map: MapDef, y: number): number => map.world.h - 100 - (y + DUDE.h);
