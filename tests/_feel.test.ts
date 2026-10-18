// Dev lab: how does one grapple feel? Rolling right on a floor, fire at a target, hold until
// the rope lets go by itself (or 120 ticks), then fly. Run with FEEL=<label>.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { girder, goal, target, type MapDef } from '../src/sim/level';
import { MAPS } from '../src/sim/maps';
import { Sim } from '../src/sim/sim';
import type { Mode } from '../src/sim/types';

function labMap(t: { x: number; y: number }): void {
  const m: MapDef = {
    ...MAPS.crane,
    world: { w: 4000, h: 4000 },
    platforms: [girder(0, 3900, 4000, 100, 0), girder(0, 0, 100, 4000, 0), girder(3900, 0, 100, 4000, 0), girder(0, 0, 4000, 100, 0), target(t.x - 12.5, t.y - 12.5, 1), goal(3800, 100, 50, 50, 0)],
  };
  (MAPS as Record<string, MapDef>).crane = m;
}

it.skipIf(!process.env.FEEL)('feel', () => {
  const out: string[] = [];
  for (const mode of ['newage', 'original'] as Mode[]) {
    out.push(`\n== ${mode}: rolling right, target at (dx, dy up) from his centre; hold until auto-release (max 120)`);
    for (const dy of [150, 250, 330]) {
      for (const dx of [-250, -150, 0, 100, 150, 250]) {
        const cx = 2000;
        const cy = 3875;
        const tx = cx + dx;
        const ty = cy - dy;
        labMap({ x: tx, y: ty });
        const s = Sim.create(mode, 1, 'crane');
        // roll for a while to get up to speed, then fire when his centre is at cx
        s.state.dude.x = cx - 23 - 200;
        s.state.dude.y = 3850;
        s.state.dude.vx = mode === 'newage' ? 3.6 : 3;
        s.state.dude.facing = 1;
        while (s.state.dude.x + 23 < cx) s.step();
        s.step([{ kind: 'press', x: tx, y: ty }]);
        let held = 0;
        let attached = -1;
        let released = -1;
        for (; held < 120; held++) {
          const ev = s.step();
          if (attached < 0 && ev.some(e => e.type === 'hookAttach')) attached = held;
          if (ev.some(e => e.type === 'hookRelease' || e.type === 'hookCancel')) {
            released = held;
            break;
          }
        }
        if (released < 0) s.step([{ kind: 'release', x: 0, y: 0 }]);
        const rel = { x: s.state.dude.x + 23 - tx, y: ty - (s.state.dude.y + 25), vx: s.state.dude.vx, vy: s.state.dude.vy };
        let apex = { x: 0, y: -1e9 };
        let land = NaN;
        for (let t = 0; t < 400; t++) {
          s.step();
          const up = ty - (s.state.dude.y + 25);
          if (up > apex.y) apex = { x: s.state.dude.x + 23 - tx, y: up };
          // where he comes down past a ledge whose top is 40 px below the target (his feet at ty + 40)
          if (s.state.dude.vy > 0 && s.state.dude.y + 50 >= ty + 40) {
            land = s.state.dude.x + 23 - tx;
            break;
          }
        }
        const sx = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(0);
        out.push(
          `dx ${String(dx).padStart(4)} dy ${dy}: attach t${attached}, ${released < 0 ? 'held 120 then let go' : `auto-release t${released}`} at (${rel.x.toFixed(0)}, ${rel.y.toFixed(0)}) v(${rel.vx.toFixed(1)}, ${rel.vy.toFixed(1)}) -> apex ${apex.y.toFixed(0)} above target at x ${sx(apex.x)}, back down to target level+40 at x ${isNaN(land) ? '-' : sx(land)}`,
        );
      }
    }
  }
  writeFileSync(`tests/_feel_${process.env.FEEL}.txt`, out.join('\n'));
});
