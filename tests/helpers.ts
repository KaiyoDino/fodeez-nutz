import { TOWER } from '../src/sim/level';
import { Sim } from '../src/sim/sim';
import type { InputEvent, Mode, SimEvent } from '../src/sim/types';

const LEVEL = TOWER.platforms;

export function sim(mode: Mode, seed = 1): Sim {
  return Sim.create(mode, seed);
}

/** Put the dude somewhere specific with a given velocity. */
export function place(s: Sim, x: number, y: number, vx = 0, vy = 0): Sim {
  s.state.dude.x = x;
  s.state.dude.y = y;
  s.state.dude.vx = vx;
  s.state.dude.vy = vy;
  s.state.airPeakY = y;
  if (s.state.original) {
    s.state.original.hookX = x + 14;
    s.state.original.hookY = y - 20;
  }
  return s;
}

export function run(s: Sim, ticks: number, inputs: (tick: number) => InputEvent[] = () => []): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) all.push(...s.step(inputs(t)));
  return all;
}

export const press = (x: number, y: number): InputEvent => ({ kind: 'press', x, y });
export const release = (x = 0, y = 0): InputEvent => ({ kind: 'release', x, y });

export function indexWhere(pred: (p: (typeof LEVEL)[number]) => boolean): number {
  const i = LEVEL.findIndex(pred);
  if (i < 0) throw new Error('platform not found');
  return i;
}

export const targetCenter = (i: number) => ({ x: LEVEL[i].x + LEVEL[i].w / 2, y: LEVEL[i].y + LEVEL[i].h / 2 });
