// Map 2, "The Crane": a new climb designed around New Age physics (rope swings, flings,
// sliding goop, one-way spring pads). You climb the tower crane next to the building from
// map 1, from the end of the night into dawn, and finish by swinging into the hook block
// hanging off the end of the jib.
//
// Sections, bottom to top:
//  1. The Yard      - ground level and a few ledges
//  2. The Mast      - a zig-zag of small ledges
//  3. The Chimney   - a shaft between two goop walls: stick, slide, fire across
//  4. Swing Line    - a row of targets over a long drop, crossed with flings
//  5. Spring Garden - one-way bounce pads you steer between with the hook
//  6. The Jib       - monkey-bars along the underside of the crane's arm, into the hook block

import { girder as g, goal, goop, spring, target as t, type MapDef, type PlatformDef } from '../map-types';

const platforms: PlatformDef[] = [
  // 0-3: outer walls
  g(0, 5900, 2400, 100, 0), // floor
  g(0, 0, 100, 6000, 0), // left wall
  g(2300, 0, 100, 6000, 0), // right wall
  g(0, 0, 2400, 100, 0), // ceiling

  // 1. THE YARD
  t(1150, 5570, 1),
  g(1450, 5470, 260, 40, 1),
  t(1780, 5230, 1),
  g(1880, 5020, 420, 40, 1),
  t(1650, 4800, 1),
  g(950, 4700, 450, 40, 1),

  // 2. THE MAST
  t(750, 4460, 2),
  g(350, 4380, 260, 40, 2),
  t(650, 4150, 2),
  t(1000, 4000, 2),
  g(1400, 3900, 550, 40, 2),

  // 3. THE CHIMNEY (shaft between the goop walls: x 1550-1850). The left wall stops short of
  // the floor so you can roll in; the exit is over the top of the left wall onto the ledge.
  goop(1500, 3050, 50, 650, 3),
  goop(1850, 3050, 50, 850, 3),
  t(1690, 3620, 3),
  t(1790, 3350, 3),
  t(1600, 3080, 3),
  g(1100, 3040, 400, 40, 3),

  // 4. SWING LINE: three targets over a long drop, then a goop wall to catch you
  t(950, 2710, 4),
  t(600, 2660, 4),
  t(260, 2620, 4),
  goop(100, 2410, 60, 350, 4),

  // 5. SPRING GARDEN
  t(300, 2340, 5),
  t(560, 2050, 5),
  spring(650, 1950, 200, 40, 5),
  t(950, 1700, 5),
  g(1050, 1500, 220, 40, 5),
  t(1400, 1300, 5),
  spring(1500, 1200, 200, 40, 5),
  t(1750, 1050, 5),

  // 6. THE CAB AND THE JIB: monkey-bars along the underside of the arm, into the hook block
  g(1850, 950, 450, 40, 6), // cab floor
  t(2000, 700, 6),
  g(350, 480, 1800, 50, 6), // the jib
  t(1850, 570, 6),
  t(1500, 570, 6),
  goop(1250, 530, 120, 30, 6),
  t(1150, 570, 6),
  t(800, 570, 6),
  goop(610, 530, 100, 30, 6),
  t(450, 570, 6),
  goal(380, 760, 120, 90, 6), // the hook block
];

export const CRANE: MapDef = {
  id: 'crane',
  name: 'The Crane',
  tagline: 'A new climb up the crane next door, built for New Age physics.',
  designedFor: 'newage',
  world: { w: 2400, h: 6000 },
  start: { x: 1177, y: 5850 },
  goopReset: { x: 1177, y: 5850 },
  teleports: [
    { x: 1177, y: 5850 },
    { x: 1100, y: 4650 },
    { x: 1600, y: 3850 },
    { x: 1250, y: 2990 },
    { x: 162, y: 2500 },
    { x: 1100, y: 1450 },
    { x: 1950, y: 900 },
  ],
  platforms,
  theme: 'dawn',
  metersPer: 40,
};
