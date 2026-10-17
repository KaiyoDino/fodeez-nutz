// The level, transcribed from the original MainFrame.java in its original
// order. Order matters: Original mode resolves collisions in list order, just
// like the Java game did.

import type { Mode } from './types';

export type PlatformKind = 'girder' | 'spring' | 'goop' | 'target' | 'goal';

/**
 * Map tricks that depend on which side of the y=1050 floor the dude is on.
 * - trapdoor: solid from below, gone once you're above it
 * - plug: fills the hole under the goal room once you're above the floor
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
  /** Which area of the map it belongs to (for decoration and stats). */
  area: 0 | 1 | 2 | 3 | 4;
}

const g = (x: number, y: number, w: number, h: number, area: PlatformDef['area'], extra: Partial<PlatformDef> = {}): PlatformDef => ({ x, y, w, h, kind: 'girder', area, ...extra });
const t = (x: number, y: number, area: PlatformDef['area'], extra: Partial<PlatformDef> = {}): PlatformDef => ({ x, y, w: 25, h: 25, kind: 'target', area, ...extra });
const goop = (x: number, y: number, w: number, h: number, area: PlatformDef['area'], extra: Partial<PlatformDef> = {}): PlatformDef => ({ x, y, w, h, kind: 'goop', area, ...extra });
const spring = (x: number, y: number, w: number, h: number, area: PlatformDef['area']): PlatformDef => ({ x, y, w, h, kind: 'spring', area });

export const WORLD = { w: 2000, h: 3900 } as const;

/** Extra platforms that only exist in New Age. Tuned with the route-finder bot. */
export const NEW_AGE_LADDER: PlatformDef[] = [
  t(1380, 2380, 2, { onlyIn: 'newage' }),
  t(1620, 2050, 2, { onlyIn: 'newage' }),
  goop(1850, 1700, 50, 150, 2, { onlyIn: 'newage' }),
  t(1640, 1500, 2, { onlyIn: 'newage' }),
  t(1840, 1110, 2, { onlyIn: 'newage' }),
];
/** The dude's hitbox, unchanged from the original. */
export const DUDE = { w: 46, h: 50 } as const;
export const START = { x: 977, y: 3750 } as const;
/** Where the original's goop timer sends you back to (it used 1000, not the spawn point). */
export const GOOP_RESET = { x: 1000, y: 3750 } as const;
/** The y=1050 floor that splits the bottom half from the top: the dude is "above" it when his top is above y=1100. */
export const FLOOR_SPLIT_Y = 1100;
/** Hysteresis so the trapdoor and plug don't flicker while the dude sits right at the line. */
export const FLOOR_SPLIT_RESET_Y = 1160;
/** Debug teleports from the original's number keys. */
export const TELEPORTS = [
  { x: 1000, y: 3750 },
  { x: 751, y: 3000 },
  { x: 1700, y: 1000 },
  { x: 800, y: 250 },
] as const;

export const LEVEL: readonly PlatformDef[] = [
  // 0-3: outer walls
  g(0, 3800, 2000, 100, 0), // floor
  g(0, 0, 100, 3900, 0), // left wall
  g(1900, 0, 100, 3900, 0), // right wall
  g(0, 0, 2000, 100, 0), // ceiling

  // AREA 1
  t(850, 3450, 1),
  g(1050, 3550, 100, 50, 1),
  t(1250, 3250, 1),
  g(1375, 3450, 75, 50, 1),
  t(1650, 3150, 1),
  g(1850, 3350, 50, 50, 1),
  t(1700, 3550, 1),
  t(1800, 3000, 1),
  t(1450, 2950, 1),
  t(1250, 2950, 1),
  t(1050, 2950, 1),
  g(750, 3050, 200, 50, 1),

  // AREA 2
  goop(700, 2850, 50, 200, 2),
  t(950, 2700, 2),
  goop(1200, 2650, 50, 200, 2),
  t(950, 2500, 2),
  goop(500, 2400, 50, 150, 2),
  t(700, 2200, 2),
  goop(300, 1950, 50, 100, 2),
  t(550, 1800, 2),
  t(550, 1500, 2),
  spring(900, 1150, 50, 900, 2), // the tall spring wall
  goop(100, 1150, 50, 100, 2),

  g(235, 1050, 665, 50, 2),
  g(900, 1050, 700, 50, 2, { role: 'trapdoor' }), // index 28
  g(1600, 1050, 185, 50, 2),
  g(100, 1050, 75, 50, 2),
  g(175, 1050, 65, 50, 2, { role: 'plug' }), // index 31

  // AREA 3
  t(250, 875, 3, { role: 'troll' }), // index 32

  spring(1700, 1150, 200, 50, 3),
  t(1875, 850, 3),
  t(1450, 200, 3),

  g(1300, 850, 150, 50, 3, { mover: { range: 200, speed: 6 } }),
  t(1400, 700, 3),

  g(1000, 650, 150, 50, 3, { mover: { range: 200, speed: 6 } }),
  t(1300, 500, 3),

  goop(1100, 350, 200, 50, 3, { mover: { range: 300, speed: 8 } }),
  t(900, 100, 3),

  g(850, 0, 50, 200, 3),
  g(850, 300, 50, 750, 3),

  // AREA 4
  g(100, 300, 187, 50, 4),
  g(337, 300, 513, 50, 4),

  g(100, 550, 462, 50, 4),
  g(612, 550, 238, 50, 4),

  g(100, 800, 275, 50, 4),
  g(425, 800, 425, 50, 4),

  // The original goal box also covered the floor girders below it (y 1050-1100); trimmed to the room.
  { x: 100, y: 850, w: 750, h: 200, kind: 'goal', area: 4 },

  // NEW AGE ONLY (appended so Original's list order is untouched).
  // The original's only way from area 2 into area 3 was sliding along the underside of the
  // floor while hooked, which its reversed-gravity pull allowed and a real rope doesn't.
  // New Age gets a short ladder up the empty right half of area 2 instead.
  ...NEW_AGE_LADDER,
];

/** Homages placed where the original put its cameo pictures. Shown once you reach area 4. */
export const CAMEOS = [
  { id: 'cauldron', x: 350, y: 125, w: 175, h: 175 },
  { id: 'king', x: 675, y: 499, w: 134, h: 51 },
  { id: 'pogo', x: 150, y: 650, w: 129, h: 150 },
] as const;

/** Area 4 reveal rule from the original: the cameos appear once you're above the floor and left of x=850. */
export const CAMEO_REVEAL = { maxX: 850, maxY: 1100 } as const;

/** Height above the starting floor, in world px, of a dude whose top-left is at y. */
export const heightOf = (y: number): number => WORLD.h - 100 - (y + DUDE.h);
