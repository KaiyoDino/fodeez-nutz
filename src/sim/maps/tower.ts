// Map 1, "The Tower": transcribed from the original MainFrame.java in its original
// order. Order matters: Original mode resolves collisions in list order, just like
// the Java game did, so new pieces go at the end. The New Age-only ladder is at the end
// for the same reason. The original goal box also covered the floor girders below it
// (y 1050-1100); here it's trimmed to the room.

// <editor> From here to the end marker, this is rewritten by the level editor (npm run dev, then open /editor.html).
import { girder as g, goal, goop, spring, target as t, type MapDef, type PlatformDef } from '../map-types';

const platforms: PlatformDef[] = [
  // 0. Outer walls
  g(0, 3800, 2000, 100, 0, { note: 'floor' }), // 0
  g(0, 0, 100, 3900, 0, { note: 'left wall' }), // 1
  g(1900, 0, 100, 3900, 0, { note: 'right wall' }), // 2
  g(0, 0, 2000, 100, 0, { note: 'ceiling' }), // 3

  // 1. Area 1
  t(850, 3450, 1), // 4
  g(1050, 3550, 100, 50, 1), // 5
  t(1250, 3250, 1), // 6
  g(1375, 3450, 75, 50, 1), // 7
  t(1650, 3150, 1), // 8
  g(1850, 3350, 50, 50, 1), // 9
  t(1700, 3550, 1), // 10
  t(1800, 3000, 1), // 11
  t(1450, 2950, 1), // 12
  t(1250, 2950, 1), // 13
  t(1050, 2950, 1), // 14
  g(750, 3050, 200, 50, 1), // 15

  // 2. Area 2
  goop(700, 2850, 50, 200, 2), // 16
  t(950, 2700, 2), // 17
  goop(1200, 2650, 50, 200, 2), // 18
  t(950, 2500, 2), // 19
  goop(500, 2400, 50, 150, 2), // 20
  t(700, 2200, 2), // 21
  goop(300, 1950, 50, 100, 2), // 22
  t(550, 1800, 2), // 23
  t(550, 1500, 2), // 24
  spring(900, 1150, 50, 900, 2, { note: 'the tall spring wall' }), // 25
  goop(100, 1150, 50, 100, 2), // 26
  g(235, 1050, 665, 50, 2), // 27
  g(900, 1050, 700, 50, 2, { role: 'trapdoor' }), // 28
  g(1600, 1050, 185, 50, 2), // 29
  g(100, 1050, 75, 50, 2), // 30
  g(175, 1050, 65, 50, 2, { role: 'plug' }), // 31

  // 3. Area 3
  t(250, 875, 3, { role: 'troll' }), // 32
  spring(1700, 1150, 200, 50, 3), // 33
  t(1875, 850, 3), // 34
  t(1450, 200, 3), // 35
  g(1300, 850, 150, 50, 3, { mover: { range: 200, speed: 6 } }), // 36
  t(1400, 700, 3), // 37
  g(1000, 650, 150, 50, 3, { mover: { range: 200, speed: 6 } }), // 38
  t(1300, 500, 3), // 39
  goop(1100, 350, 200, 50, 3, { mover: { range: 300, speed: 8 } }), // 40
  t(900, 100, 3), // 41
  g(850, 0, 50, 200, 3), // 42
  g(850, 300, 50, 750, 3), // 43

  // 4. Area 4
  g(100, 300, 187, 50, 4), // 44
  g(337, 300, 513, 50, 4), // 45
  g(100, 550, 462, 50, 4), // 46
  g(612, 550, 238, 50, 4), // 47
  g(100, 800, 275, 50, 4), // 48
  g(425, 800, 425, 50, 4), // 49
  goal(100, 850, 750, 200, 4, { note: 'the goal room' }), // 50

  // 2. Area 2 (New Age only)
  t(1380, 2380, 2, { onlyIn: 'newage' }), // 51
  t(1620, 2050, 2, { onlyIn: 'newage' }), // 52
  goop(1850, 1700, 50, 150, 2, { onlyIn: 'newage' }), // 53
  t(1640, 1500, 2, { onlyIn: 'newage' }), // 54
  t(1840, 1110, 2, { onlyIn: 'newage' }), // 55
];

const spots = {
  start: { x: 977, y: 3750 },
  goopReset: { x: 1000, y: 3750 },
  teleports: [
    { x: 1000, y: 3750 },
    { x: 751, y: 3000 },
    { x: 1700, y: 1000 },
    { x: 800, y: 250 },
  ],
};
// </editor>

/**
 * Extra platforms that only exist in New Age. The original's only way from area 2 into
 * area 3 was sliding along the underside of the floor while hooked, which its reversed-
 * gravity pull allowed and a real rope doesn't. New Age gets a short ladder up the empty
 * right half of area 2 instead. Tuned with the route-finder bot.
 */
export const NEW_AGE_LADDER: PlatformDef[] = platforms.filter(p => p.onlyIn === 'newage');

export const TOWER: MapDef = {
  id: 'tower',
  name: 'The Tower',
  tagline: 'The original 2023 map, built for the original physics.',
  designedFor: 'original',
  world: { w: 2000, h: 3900 },
  // (the original's goop timer sent you to x=1000, not the spawn point)
  ...spots,
  platforms,
  areas: ['Outer walls', 'Area 1', 'Area 2', 'Area 3', 'Area 4'],
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
