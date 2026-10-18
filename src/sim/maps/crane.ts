// Map 2, "The Crane": a climb designed around New Age physics (a rope that reels you in and
// flings you on, sliding goop, one-way spring pads). You climb the tower crane next to the
// building from map 1, from the end of the night into dawn, and finish on the hook block
// hanging off the end of the jib.
//
// Design rules: the main route never needs a precisely timed release (holding until the
// rope lets go works); ledges are wide and stacked so a missed shot usually drops you one
// ledge, not to the bottom; each section starts on a rest ledge with bumpers (short posts
// that turn him around, so he rolls back and forth while you line up a shot). Target
// positions were tuned with tests/_moves.test.ts for wide firing windows.
//
// Sections, bottom to top:
//  1. The Yard - grapple up a zig-zag of ledges.
//  2. The Mast - the same, plus one spot where you chain two shots in one jump.
//  3. The Chimney - a shaft between two goop walls. A shot at a target near one wall flings
//     you into the other; zig-zag up and out over the shorter right wall.
//  4. The Zip Line - chain three shots left across the gap, onto the goop wall.
//  5. The Spring Garden - one-way bounce pads (you pass up through them; they catch you from
//     above). Each bounce refills your shots; at the top of a bounce, shoot up and right.
//  6. The Cab and the Jib - from the cab, shoot up to a goop pad under the arm, chain two
//     shots across to the next pad, and one last shot drops you onto the hook block.

// <editor> From here to the end marker, this is rewritten by the level editor (npm run dev, then open /editor.html).
import { girder as g, goal, goop, spring, target as t, type MapDef, type PlatformDef } from '../map-types';

const platforms: PlatformDef[] = [
  // 0. Outer walls
  g(0, 5900, 2400, 100, 0, { note: 'floor' }), // 0
  g(0, 0, 100, 6000, 0, { note: 'left wall' }), // 1
  g(2300, 0, 100, 6000, 0, { note: 'right wall' }), // 2
  g(0, 0, 2400, 100, 0, { note: 'ceiling' }), // 3

  // 1. The Yard
  t(1408, 5608, 1), // 4
  g(1480, 5660, 420, 40, 1), // 5
  g(1880, 5630, 20, 30, 1, { note: 'bumper' }), // 6
  t(1388, 5368, 1), // 7
  g(950, 5420, 380, 40, 1), // 8
  t(858, 5128, 1), // 9
  g(400, 5180, 420, 40, 1), // 10
  t(888, 4888, 1), // 11

  // 2. The Mast
  g(960, 4940, 600, 40, 2, { note: 'rest ledge' }), // 12
  g(960, 4910, 20, 30, 2, { note: 'bumper' }), // 13
  g(1540, 4910, 20, 30, 2, { note: 'bumper' }), // 14
  t(1488, 4688, 2), // 15
  t(1690, 4370, 2), // 16
  g(1780, 4420, 520, 40, 2), // 17
  g(1780, 4390, 20, 30, 2, { note: 'bumper' }), // 18
  t(1688, 4158, 2), // 19
  g(1150, 4210, 450, 40, 2), // 20
  t(1068, 3928, 2), // 21

  // 3. The Chimney
  g(560, 3990, 440, 40, 3, { note: 'rest ledge' }), // 22
  g(560, 3960, 20, 30, 3, { note: 'bumper' }), // 23
  g(980, 3960, 20, 30, 3, { note: 'bumper' }), // 24
  goop(600, 3050, 50, 700, 3), // 25
  goop(900, 3300, 50, 450, 3), // 26
  t(688, 3688, 3), // 27
  t(838, 3438, 3), // 28
  t(688, 3188, 3), // 29
  t(918, 3008, 3), // 30

  // 4. The Zip Line
  g(1000, 3100, 500, 40, 4, { note: 'rest ledge' }), // 31
  g(1480, 3070, 20, 30, 4, { note: 'bumper' }), // 32
  t(838, 2818, 4), // 33
  t(538, 2738, 4), // 34
  t(258, 2688, 4), // 35
  goop(100, 2450, 50, 400, 4), // 36

  // 5. The Spring Garden
  t(238, 2318, 5), // 37
  spring(300, 2400, 300, 40, 5), // 38
  t(813, 1663, 5), // 39
  spring(950, 1700, 300, 40, 5), // 40
  t(1408, 1233, 5), // 41
  spring(1450, 1160, 300, 40, 5), // 42
  t(1773, 773, 5), // 43

  // 6. The Cab and the Jib
  g(1800, 950, 500, 40, 6, { note: 'cab floor, rest ledge' }), // 44
  g(1800, 920, 20, 30, 6, { note: 'bumper' }), // 45
  g(350, 480, 1800, 50, 6, { note: 'the jib' }), // 46
  t(1783, 643, 6), // 47
  goop(1400, 530, 260, 40, 6), // 48
  t(1238, 578, 6), // 49
  t(888, 573, 6), // 50
  goop(750, 530, 200, 40, 6), // 51
  t(728, 603, 6), // 52
  goal(380, 760, 120, 90, 6, { note: 'the hook block' }), // 53
];

const spots = {
  start: { x: 1177, y: 5850 },
  goopReset: { x: 1177, y: 5850 },
  teleports: [
    { x: 1177, y: 5850 },
    { x: 1100, y: 4890 },
    { x: 760, y: 3940 },
    { x: 1200, y: 3050 },
    { x: 152, y: 2550 },
    { x: 1950, y: 900 },
  ],
};
// </editor>

export const CRANE: MapDef = {
  id: 'crane',
  name: 'The Crane',
  tagline: 'A new climb up the crane next door, built for New Age physics.',
  designedFor: 'newage',
  world: { w: 2400, h: 6000 },
  ...spots,
  platforms,
  areas: ['Outer walls', 'The Yard', 'The Mast', 'The Chimney', 'The Zip Line', 'The Spring Garden', 'The Cab and the Jib'],
  theme: 'dawn',
  metersPer: 40,
};
