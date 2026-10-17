import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import type { InputEvent } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import type { Route } from './route-finder';

it('trace', () => {
  const mode = process.env.TRACE_MODE ?? 'original';
  const route = JSON.parse(readFileSync(`tests/routes/${mode}.json`, 'utf8')) as Route;
  const sim = Sim.create(route.mode, route.seed);
  const by = new Map<number, InputEvent[]>();
  for (const i of route.inputs) {
    const l = by.get(i.tick) ?? [];
    l.push(i);
    by.set(i.tick, l);
  }
  const lines: string[] = [];
  while (!sim.state.won && sim.state.stats.ticks < 4000) {
    const t = sim.state.stats.ticks;
    const inp = by.get(t) ?? [];
    const ev = sim.step(inp);
    const d = sim.state.dude;
    if (inp.length || t % 10 === 0 || ev.some(e => e.type !== 'land'))
      lines.push(`${t} (${d.x.toFixed(0)},${d.y.toFixed(0)}) v(${d.vx.toFixed(1)},${d.vy.toFixed(1)}) ${inp.map(i => i.kind + '@' + i.x.toFixed(0) + ',' + i.y.toFixed(0)).join(' ')} ${ev.map(e => e.type).join(',')}`);
  }
  writeFileSync('tests/_trace.txt', lines.join('\n'));
});
