// Map 1, "The Tower": transcribed from the original MainFrame.java in its original
// order. Order matters: Original mode resolves collisions in list order, just like
// the Java game did.

import { girder as g, goal, goop, spring, target as t, type MapDef, type PlatformDef } from '../map-types';

/**
 * Extra platforms that only exist in New Age. The original's only way from area 2 into
 * area 3 was sliding along the underside of the floor while hooked, which its reversed-
 * gravity pull allowed and a real rope doesn't. New Age gets a short ladder up the empty
 * right half of area 2 instead. Tuned with the route-finder bot.
 */
export const NEW_AGE_LADDER: PlatformDef[] = [
  t(1380, 2380, 2, { onlyIn: 'newage' }),
  t(1620, 2050, 2, { onlyIn: 'newage' }),
  goop(1850, 1700, 50, 150, 2, { onlyIn: 'newage' }),
  t(1640, 1500, 2, { onlyIn: 'newage' }),
  t(1840, 1110, 2, { onlyIn: 'newage' }),
];

const platforms: PlatformDef[] = [
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
  goal(100, 850, 750, 200, 4),

  // NEW AGE ONLY (appended so Original's list order is untouched)
  ...NEW_AGE_LADDER,
];

export const TOWER: MapDef = {
  id: 'tower',
  name: 'The Tower',
  tagline: 'The original 2023 map, built for the original physics.',
  designedFor: 'original',
  world: { w: 2000, h: 3900 },
  start: { x: 977, y: 3750 },
  // the original's goop timer sent you to x=1000, not the spawn point
  goopReset: { x: 1000, y: 3750 },
  teleports: [
    { x: 1000, y: 3750 },
    { x: 751, y: 3000 },
    { x: 1700, y: 1000 },
    { x: 800, y: 250 },
  ],
  platforms,
  // the y=1050 floor: "above" once the dude's top passes y=1100 (with a little hysteresis so nothing flickers)
  split: { y: 1100, resetY: 1160 },
  // homages placed where the original put its cameo pictures
  cameos: [
    { id: 'cauldron', x: 350, y: 125, w: 175, h: 175 },
    { id: 'king', x: 675, y: 499, w: 134, h: 51 },
    { id: 'pogo', x: 150, y: 650, w: 129, h: 150 },
  ],
  cameoReveal: { maxX: 850, maxY: 1100 },
  theme: 'sunset',
  metersPer: 40,
};
