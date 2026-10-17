// Dev lab: measures what New Age movement can do, to design the crane map around. Run with LAB=1.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { girder, goal, target, type MapDef } from '../src/sim/level';
import { MAPS } from '../src/sim/maps';
import { Sim } from '../src/sim/sim';

function labMap(targets: { x: number; y: number }[]): void {
  const m: MapDef = {
    ...MAPS.crane,
    world: { w: 4000, h: 4000 },
    platforms: [girder(0, 3900, 4000, 100, 0), girder(0, 0, 100, 4000, 0), girder(3900, 0, 100, 4000, 0), girder(0, 0, 4000, 100, 0), ...targets.map(t => target(t.x, t.y, 1)), goal(3800, 100, 50, 50, 0)],
  };
  (MAPS as Record<string, MapDef>).crane = m;
}

it.skipIf(!process.env.LAB)('lab', () => {
  const out: string[] = [];
  // 1. vertical: dude standing still on the floor, target straight above at height H above his hand
  out.push('VERTICAL: target H above the hand, hold N ticks, release -> apex above target, ticks to apex');
  for (const H of [150, 250, 330]) {
    for (const hold of [10, 20, 30, 45, 60, 90]) {
      labMap([{ x: 2000 - 12, y: 3850 - 32 - H - 12 }]);
      const s = Sim.create('newage', 1, 'crane');
      s.state.dude.x = 2000 - 23; s.state.dude.y = 3850; s.state.dude.vx = 0;
      const tc = { x: 2000, y: 3850 - 32 - H };
      s.step([{ kind: 'press', x: tc.x, y: tc.y }]);
      let attachedAt = -1;
      for (let t = 0; t < hold; t++) { const ev = s.step(); if (attachedAt < 0 && ev.some(e => e.type === 'hookAttach')) attachedAt = t; if (s.state.newage!.hook.state === 'idle' && attachedAt >= 0) break; }
      s.step([{ kind: 'release', x: 0, y: 0 }]);
      let apex = s.state.dude.y; let tt = 0;
      for (let t = 0; t < 200; t++) { s.step(); if (s.state.dude.y < apex) { apex = s.state.dude.y; tt = t; } if (s.state.dude.vy > 0) break; }
      out.push(`H=${H} hold=${hold}: apex ${(tc.y - (apex + 18)).toFixed(0)} px above target (hand), x drift ${(s.state.dude.x - (2000 - 23)).toFixed(0)}, ${tt} ticks after release`);
    }
  }
  // 2. swing: target at (dx, -dy) from the dude's hand; hold N; release; how far/high does he fly?
  out.push('\nSWING: target offset (dx right, dy up) from hand; hold N; release -> max height gained (hand) and horizontal distance when back at release height');
  for (const [dx, dy] of [[150, 250], [250, 200], [300, 100], [330, 0]]) {
    for (const hold of [15, 30, 45, 60]) {
      labMap([{ x: 1500 + dx - 12, y: 3868 - dy - 12 }]);
      const s = Sim.create('newage', 1, 'crane');
      s.state.dude.x = 1500 - 23; s.state.dude.y = 3850; s.state.dude.vx = 0;
      s.step([{ kind: 'press', x: 1500 + dx, y: 3868 - dy }]);
      for (let t = 0; t < hold; t++) s.step();
      const relY = s.state.dude.y; const relX = s.state.dude.x;
      s.step([{ kind: 'release', x: 0, y: 0 }]);
      let apex = s.state.dude.y; let apexX = s.state.dude.x;
      let landX = NaN;
      for (let t = 0; t < 300; t++) { s.step(); if (s.state.dude.y < apex) { apex = s.state.dude.y; apexX = s.state.dude.x; } if (s.state.dude.vy > 0 && s.state.dude.y >= relY) { landX = s.state.dude.x; break; } }
      out.push(`target +${dx},+${dy} hold=${hold}: released at hand (${(relX + 23 - 1500).toFixed(0)}, ${(3868 - relY - 18).toFixed(0)} up), apex ${(3868 - apex - 18).toFixed(0)} up at x+${(apexX + 23 - 1500).toFixed(0)}, back at release height x+${isNaN(landX) ? '-' : (landX + 23 - 1500).toFixed(0)}`);
    }
  }
  writeFileSync('tests/_lab.txt', out.join('\n'));
});
