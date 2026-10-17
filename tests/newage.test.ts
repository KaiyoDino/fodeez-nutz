import { describe, expect, it } from 'vitest';
import { LEVEL, START } from '../src/sim/level';
import { handOf, NA } from '../src/sim/newage';
import { indexWhere, place, press, release, run, sim, targetCenter } from './helpers';

const firstTarget = indexWhere(p => p.kind === 'target' && p.x === 850 && p.y === 3450);

describe('New Age: rolling', () => {
  it('cruises at a steady speed and never stops', () => {
    const s = sim('newage');
    run(s, 120);
    expect(Math.abs(s.state.dude.vx)).toBeCloseTo(NA.cruise, 5);
    expect(s.state.dude.y).toBeCloseTo(START.y, 5);
  });

  it('bounces off walls and rolls back the other way', () => {
    const s = place(sim('newage'), 110, START.y, -NA.cruise, 0);
    s.state.dude.facing = -1;
    run(s, 30);
    expect(s.state.dude.vx).toBeGreaterThan(0);
    expect(s.state.dude.x).toBeGreaterThanOrEqual(100);
  });

  it('caps falling speed', () => {
    const s = place(sim('newage'), 1300, 400, 0, 0);
    let maxVy = 0;
    for (let t = 0; t < 200; t++) {
      s.step();
      maxVy = Math.max(maxVy, s.state.dude.vy);
    }
    expect(maxVy).toBeLessThanOrEqual(NA.maxFall + 1e-9);
  });
});

describe('New Age: springs', () => {
  it('multiply by 1.75 but stop at the cap', () => {
    const s = place(sim('newage'), 1800, 1085, 0, 20);
    const ev = s.step();
    expect(ev.some(e => e.type === 'spring')).toBe(true);
    expect(s.state.dude.vy).toBe(-NA.springCap);
  });

  it('keep him rolling, so he can never bounce in place forever', () => {
    // dead still on top of the tall spring wall, in the 50 px slot under the floor
    const s = place(sim('newage'), 902, 1100, 0, 0.5);
    s.state.dude.facing = 1;
    run(s, 120);
    expect(s.state.dude.x).toBeGreaterThan(950);
  });

  it('always give at least a small boing', () => {
    const s = place(sim('newage'), 1800, 1099.5, 0, 1);
    s.step();
    expect(s.state.dude.vy).toBe(-NA.springMin);
  });
});

describe('New Age: the rope', () => {
  it('fires in any direction', () => {
    const s = place(sim('newage'), 1000, 3600, 0, 0);
    const ev = s.step([press(1000, 3790)]);
    expect(ev.some(e => e.type === 'hookFire')).toBe(true);
  });

  it('swings on a rope that never stretches, and winds in while held', () => {
    const s = place(sim('newage'), 830, START.y, NA.cruise, 0);
    const c = targetCenter(firstTarget);
    s.step([press(c.x, c.y)]);
    let attached = false;
    for (let t = 0; t < 30 && !attached; t++) attached = s.step().some(e => e.type === 'hookAttach');
    expect(attached).toBe(true);
    const lens: number[] = [];
    for (let t = 0; t < 40 && s.state.newage!.hook.state === 'attached'; t++) {
      s.step();
      const h = s.state.newage!.hook;
      if (h.state !== 'attached') break;
      const hand = handOf(s.state.dude);
      expect(Math.hypot(hand.x - h.x, hand.y - h.y)).toBeLessThanOrEqual(h.len + 0.5);
      lens.push(h.len);
    }
    expect(lens.length).toBeGreaterThan(5);
    expect(lens[lens.length - 1]).toBeLessThan(lens[0]);
  });

  it('letting go keeps momentum and adds a hop', () => {
    const s = place(sim('newage'), 830, START.y, NA.cruise, 0);
    const c = targetCenter(firstTarget);
    s.step([press(c.x, c.y)]);
    for (let t = 0; t < 30 && s.state.newage!.hook.state !== 'attached'; t++) s.step();
    run(s, 10);
    const vx = s.state.dude.vx;
    const ev = s.step([release()]);
    expect(ev.some(e => e.type === 'hookRelease')).toBe(true);
    expect(Math.sign(s.state.dude.vx)).toBe(Math.sign(vx));
  });

  it('allows 3 grapples per airtime', () => {
    const s = place(sim('newage'), 840, 3200, 0, 0);
    s.state.newage!.grapples = 3;
    const ev = s.step([press(860, 3000)]);
    expect(ev.some(e => e.type === 'hookCancel' && e.reason === 'spent')).toBe(true);
    expect(s.state.newage!.hook.state).toBe('idle');
  });

  it('is blocked by girders', () => {
    const s = place(sim('newage'), 1070, START.y, 0, 0);
    const ev = run(s, 10, t => (t === 0 ? [press(1100, 3560)] : []));
    expect(ev.some(e => e.type === 'hookCancel' && e.reason === 'blocked')).toBe(true);
  });

  it('gives up past 350 px', () => {
    const s = place(sim('newage'), 1550, START.y, 0, 0);
    const ev = run(s, 30, t => (t === 0 ? [press(1573, 3000)] : []));
    const cancel = ev.find(e => e.type === 'hookCancel');
    expect(cancel && cancel.type === 'hookCancel' && cancel.reason).toBe('range');
  });
});

describe('New Age: goop', () => {
  const goopIndex = indexWhere(p => p.kind === 'goop' && p.x === 700);
  const goop = LEVEL[goopIndex];

  it('holds him while he slides slowly down, then lets go after 160 ticks', () => {
    const s = place(sim('newage'), goop.x + goop.w + 2, 2880, -4, 0);
    s.step();
    expect(s.state.newage!.stuck?.side).toBe('right');
    const y0 = s.state.dude.y;
    run(s, 80);
    expect(s.state.dude.y - y0).toBeCloseTo(80 * NA.goopSlide, 5);
    const ev = run(s, 80);
    expect(ev.some(e => e.type === 'goopLetGo')).toBe(true);
    expect(s.state.newage!.stuck).toBeNull();
    run(s, 20);
    expect(s.state.newage!.stuck).toBeNull();
    expect(s.state.dude.y - y0).toBeGreaterThan(50);
  });

  it('slides along the top in the direction he was rolling, and off the edge', () => {
    const s = place(sim('newage'), goop.x + 2, goop.y - 50 - 4, 3, 4);
    s.step();
    expect(s.state.newage!.stuck?.side).toBe('top');
    const x0 = s.state.dude.x;
    run(s, 40);
    expect(s.state.dude.x - x0).toBeCloseTo(40 * NA.goopSlide, 5);
  });

  it('refills grapples', () => {
    const s = place(sim('newage'), goop.x + goop.w + 2, 2880, -4, 0);
    s.state.newage!.grapples = 3;
    s.step();
    expect(s.state.newage!.grapples).toBe(0);
  });

  it('can be fired from', () => {
    const s = place(sim('newage'), goop.x + goop.w + 2, 2880, -4, 0);
    s.step();
    const t = indexWhere(p => p.kind === 'target' && p.x === 950 && p.y === 2700);
    const c = targetCenter(t);
    const ev = run(s, 20, k => (k === 0 ? [press(c.x, c.y)] : []));
    expect(ev.some(e => e.type === 'hookAttach')).toBe(true);
    expect(s.state.newage!.stuck).toBeNull();
  });
});

describe('New Age: map tricks', () => {
  it('the troll target lets go of the plunger once he is above the floor', () => {
    const troll = indexWhere(p => p.role === 'troll');
    // poke his head up through the hole while hanging from the troll target
    const s = place(sim('newage'), 185, 1101, 0, -10);
    s.state.newage!.hook = { state: 'attached', x: LEVEL[troll].x + 12.5, y: LEVEL[troll].y + 12.5, vx: 0, vy: 0, traveled: 0, len: 260, target: troll, held: 0 };
    s.state.newage!.pressed = true;
    let released = false;
    for (let t = 0; t < 5 && !released; t++) released = s.step().some(e => e.type === 'hookRelease');
    expect(released).toBe(true);
    run(s, 30);
    // the plug shut under the goal room and pushed him back down
    expect(s.state.dude.y).toBeGreaterThanOrEqual(1100);
    expect(s.state.won).toBe(false);
  });

  it('wins on reaching the goal room', () => {
    const s = place(sim('newage'), 400, 900, 0, 0);
    expect(s.step().some(e => e.type === 'win')).toBe(true);
  });
});
