// Dev tool: TRACE=tower-newage npx vitest run tests/_trace.test.ts writes tests/_trace.txt,
// a tick-by-tick log of a recorded route (inputs and interesting events).
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { ReplayRunner, type Replay } from '../src/sim/replay';

it.skipIf(!process.env.TRACE)('trace', () => {
  const route = JSON.parse(readFileSync(`src/data/routes/${process.env.TRACE}.json`, 'utf8')) as Replay;
  const r = new ReplayRunner(route);
  const lines: string[] = [];
  while (!r.done) {
    const t = r.tick;
    const inp = r.pending();
    const ev = r.step();
    const d = r.sim.state.dude;
    if (inp.length || t % 10 === 0 || ev.some(e => e.type !== 'land'))
      lines.push(`${t} (${d.x.toFixed(0)},${d.y.toFixed(0)}) v(${d.vx.toFixed(1)},${d.vy.toFixed(1)}) ${inp.map(i => i.kind + '@' + i.x.toFixed(0) + ',' + i.y.toFixed(0)).join(' ')} ${ev.map(e => e.type).join(',')}`);
  }
  writeFileSync('tests/_trace.txt', lines.join('\n'));
});
