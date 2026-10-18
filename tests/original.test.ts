import { describe, expect, it } from 'vitest';
import { TOWER } from '../src/sim/level';
import { Sim } from '../src/sim/sim';
import { indexWhere, place, press, release, run, sim, targetCenter } from './helpers';

const GOOP_RESET = TOWER.goopReset;
const LEVEL = TOWER.platforms;
const START = TOWER.start;

const firstTarget = indexWhere(p => p.kind === 'target' && p.x === 850 && p.y === 3450);

describe('Original: rolling', () => {
  it('starts from rest and settles between 3 and 4 px/tick without ever stopping', () => {
    const s = sim('original', 7);
    const speeds: number[] = [];
    for (let t = 0; t < 120; t++) {
      s.step();
      speeds.push(Math.abs(s.state.dude.vx));
    }
    expect(speeds.slice(0, 4)).toEqual([1, 2, 3, 4]);
    for (const v of speeds.slice(3)) expect([3, 4]).toContain(v);
    expect(s.state.dude.y).toBe(START.y);
  });

  it('picks its first direction at random (the original always went left)', () => {
    const dirs = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = sim('original', seed);
      s.step();
      dirs.add(Math.sign(s.state.dude.vx));
    }
    expect(dirs).toEqual(new Set([-1, 1]));
  });

  it('bounces off a wall at 0.4x and rolls back the other way', () => {
    const s = place(sim('original'), 104, START.y, -4, 0);
    s.step(); // friction: -4 -> -3, x = 101
    s.step(); // friction: -3 -> -4, x = 97 overlaps the wall and is pushed back out
    expect(s.state.dude.x).toBe(100);
    expect(s.state.dude.vx).toBe(1); // trunc(3 * 0.4)
  });
});

describe('Original: the hook', () => {
  it('only fires when you click more than 25 px above him', () => {
    const s = place(sim('original'), 840, START.y, 0, 0);
    s.step([press(900, START.y - 25)]);
    expect(s.state.original!.wantsHook).toBe(false);
    s.step([release(), press(900, START.y - 26)]);
    expect(s.state.original!.wantsHook).toBe(true);
  });

  it('flies at 30 px/tick, catches a target, then yanks him up with reversed gravity', () => {
    const s = place(sim('original'), 840, START.y, 3, 0);
    const c = targetCenter(firstTarget);
    const hookY0 = s.state.original!.hookY;
    s.step([press(c.x, c.y)]);
    expect(hookY0 - s.state.original!.hookY).toBe(30);
    let attachTick = -1;
    for (let t = 0; t < 20 && attachTick < 0; t++) {
      const ev = s.step();
      if (ev.some(e => e.type === 'hookAttach')) attachTick = t;
    }
    expect(attachTick).toBeGreaterThan(0);
    const o = s.state.original!;
    expect(o.gravity).toBe(-1);
    expect(s.state.dude.vy).toBe(-2);
    const expectedVx = Math.trunc(Math.abs(o.hookX - s.state.dude.x) / 9) * (o.mouseX >= s.state.dude.x ? 1 : -1);
    expect(s.state.dude.vx).toBe(expectedVx);
    // reversed gravity: vy keeps dropping by 1 a tick
    s.step();
    expect(s.state.dude.vy).toBe(-3);
  });

  it('auto-releases 50 px above the hook, halving horizontal speed', () => {
    const s = place(sim('original'), 840, START.y, 3, 0);
    const c = targetCenter(firstTarget);
    s.step([press(c.x, c.y)]);
    let released = false;
    let vxBefore = 0;
    for (let t = 0; t < 120 && !released; t++) {
      vxBefore = s.state.dude.vx;
      const ev = s.step();
      released = ev.some(e => e.type === 'hookRelease' && e.auto);
    }
    expect(released).toBe(true);
    expect(s.state.dude.y).toBeLessThan(s.state.original!.hookY - 50);
    expect(s.state.dude.vx).toBe(Math.trunc(vxBefore / 2));
    expect(s.state.original!.grapples).toBe(1);
  });

  it('letting go gives a -10 boost and halves horizontal speed', () => {
    const s = place(sim('original'), 840, START.y, 3, 0);
    const c = targetCenter(firstTarget);
    s.step([press(c.x, c.y)]);
    for (let t = 0; t < 20 && !s.state.original!.attached; t++) s.step();
    s.step();
    const { vx, vy } = s.state.dude;
    const ev = s.step([release()]);
    expect(ev.some(e => e.type === 'hookRelease' && !e.auto)).toBe(true);
    // release applies before the tick; this tick then adds +1 gravity
    expect(s.state.original!.grapples).toBe(1);
    expect(s.state.dude.vx === Math.trunc(vx / 2) || Math.abs(s.state.dude.vx) < Math.abs(vx)).toBe(true);
    expect(s.state.dude.vy).toBe(vy - 10 + 1);
  });

  it('a quick click no longer gives a free mid-air boost', () => {
    const s = place(sim('original'), 840, START.y, 3, 0);
    const c = targetCenter(firstTarget);
    s.step([press(c.x, c.y)]);
    for (let t = 0; t < 120; t++) {
      const ev = s.step();
      if (ev.some(e => e.type === 'hookRelease')) break;
    }
    // He's now airborne with the old hook's dx/dy left at 0, which fooled the original.
    // (Releasing also resets gravity, which the original did too, so compare against a plain release.)
    const control = new Sim(structuredClone(s.state));
    control.step([release()]);
    s.step([press(s.state.dude.x, s.state.dude.y - 200), release()]);
    expect(s.state.dude.vy).toBe(control.state.dude.vy);
    expect(s.state.original!.grapples).toBe(control.state.original!.grapples);
  });

  it('gives up past 350 px', () => {
    // straight up through empty space from x=1550
    const s = place(sim('original'), 1550, START.y, 0, 0);
    let cancelled = -1;
    for (let t = 0; t < 30 && cancelled < 0; t++) {
      const ev = s.step(t === 0 ? [press(1564, 3000)] : []);
      if (ev.some(e => e.type === 'hookCancel' && e.reason === 'range')) cancelled = t;
    }
    // the hook starts 20 px above him and climbs 30 a tick; past 350 on the 11th move
    expect(cancelled).toBe(10);
  });

  it('only allows 3 grapples per airtime', () => {
    // airborne, so landing doesn't refill his grapples
    const s = place(sim('original'), 840, 3600, 0, 0);
    s.state.original!.grapples = 3;
    const c = targetCenter(firstTarget);
    const ev = run(s, 15, t => (t === 0 ? [press(c.x, c.y)] : []));
    expect(ev.some(e => e.type === 'hookCancel' && e.reason === 'spent')).toBe(true);
    expect(ev.some(e => e.type === 'hookAttach')).toBe(false);
  });

  it('is blocked by girders', () => {
    // fire up at the girder at (1050, 3550)
    const s = place(sim('original'), 1070, START.y, 0, 0);
    const ev = run(s, 10, t => (t === 0 ? [press(1100, 3560)] : []));
    expect(ev.some(e => e.type === 'hookCancel' && e.reason === 'blocked')).toBe(true);
  });
});

describe('Original: surfaces', () => {
  it('springs multiply by 1.75 with no cap', () => {
    const s = place(sim('original'), 1800, 1061, 0, 39);
    const ev = s.step();
    expect(ev.some(e => e.type === 'spring')).toBe(true);
    expect(s.state.dude.vy).toBe(-70);
  });

  it('never tunnels through a floor, however fast he falls', () => {
    const s = place(sim('original'), 1200, 3000, 0, 1500);
    s.step();
    expect(s.state.dude.y).toBe(START.y);
  });

  it('goop holds him for 160 ticks, then sends him back to the start', () => {
    const goop = indexWhere(p => p.kind === 'goop' && p.x === 700);
    const s = place(sim('original'), LEVEL[goop].x + 52, 2900, -4, 0);
    s.step();
    expect(s.state.original!.onSticky).toBe(true);
    expect(s.state.original!.stuckSide).toBe('right');
    const ev = run(s, 160);
    const resetAt = ev.findIndex(e => e.type === 'goopReset');
    expect(resetAt).toBeGreaterThanOrEqual(0);
    // the rest of that tick runs, so he has already started rolling 1 px either way
    expect(Math.abs(s.state.dude.x - GOOP_RESET.x)).toBeLessThanOrEqual(1);
    expect(s.state.dude.y).toBe(GOOP_RESET.y);
    expect(s.state.stats.goopResets).toBe(1);
  });

  it('standing on top of goop stops him dead, and counts as stuck for the goop timer', () => {
    const goop = indexWhere(p => p.kind === 'goop' && p.x === 700);
    const s = place(sim('original'), 702, 2850 - 50 - 5, 3, 4);
    run(s, 100);
    expect(s.state.dude.vx).toBe(0);
    expect(s.state.dude.y).toBe(LEVEL[goop].y - 50);
    run(s, 100);
    expect(s.state.stats.goopResets).toBe(1);
  });

  it('rides moving girders at platform speed + 2', () => {
    const s = place(sim('original'), 1350, 800, 0, 0);
    s.step();
    expect(s.state.dude.vx).toBe(8);
    expect(s.state.original!.onMoving).toBe(true);
  });

  it('the trapdoor floor is solid from below and gone from above', () => {
    const below = place(sim('original'), 1200, 1105, 0, -10);
    below.step();
    expect(below.state.dude.y).toBe(1100);
    expect(below.state.dude.vy).toBe(2); // trunc(9 * 0.3)

    const above = place(sim('original'), 1200, 990, 0, 0);
    run(above, 40);
    expect(above.state.dude.y).toBeGreaterThan(1200);
  });

  it('the hole under the goal room closes as soon as he gets his head through', () => {
    const s = place(sim('original'), 185, 1110, 0, -8);
    for (let t = 0; t < 10; t++) {
      s.step();
      s.state.dude.vy = -8;
    }
    expect(s.state.dude.y).toBeGreaterThanOrEqual(1100);
    expect(s.state.world.above).toBe(true);
    expect(s.state.won).toBe(false);
  });

  it('wins on reaching the goal room', () => {
    const s = place(sim('original'), 400, 900, 0, 0);
    const ev = s.step();
    expect(ev.some(e => e.type === 'win')).toBe(true);
    expect(s.state.won).toBe(true);
  });

  it('a plunger fired just before the goop reset does not yank him back up', () => {
    // stuck on the goop wall at the bottom of area 2, one tick before the reset
    const goopWall = indexWhere(p => p.kind === 'goop' && p.x === 700 && p.y === 2850);
    const g = TOWER.platforms[goopWall];
    const s = place(sim('original'), g.x + g.w, 2900, -3, 0);
    run(s, 3);
    expect(s.state.original!.onSticky).toBe(true);
    s.state.original!.dying = 158;
    // a target right next to him, so the plunger would catch at once
    const c = targetCenter(indexWhere(p => p.kind === 'target' && p.x === 950 && p.y === 2700));
    const ev = run(s, 40, t => (t === 0 ? [press(c.x, c.y)] : []));
    expect(ev.some(e => e.type === 'goopReset')).toBe(true);
    expect(ev.some(e => e.type === 'hookAttach')).toBe(false);
    expect(s.state.dude.y).toBeGreaterThan(3600);
  });

  it('a drop of 15 m is not a fall; the OUCH is for 30 m and more', () => {
    const s = place(sim('original'), 1300, 3150, 0, 0);
    const ev = run(s, 200);
    expect(ev.some(e => e.type === 'fall')).toBe(false);
    expect(s.state.stats.falls).toBe(0);
  });

  it('counts big drops as falls', () => {
    const s = place(sim('original'), 1300, 2400, 0, 0);
    const ev = run(s, 200);
    expect(ev.some(e => e.type === 'fall')).toBe(true);
    expect(s.state.stats.falls).toBe(1);
  });
});

describe('saves', () => {
  it('round-trips through JSON and refuses saves from a different map', async () => {
    const { loadSimState } = await import('../src/sim/sim');
    const s = sim('newage', 3);
    run(s, 50);
    const copy = loadSimState(JSON.parse(JSON.stringify(s.state)));
    expect(copy).not.toBeNull();
    expect(copy!.dude).toEqual(s.state.dude);
    const old = JSON.parse(JSON.stringify(s.state));
    old.world.platX.pop();
    expect(loadSimState(old)).toBeNull();
    expect(loadSimState({ v: 99 })).toBeNull();
    expect(loadSimState(null)).toBeNull();
  });
});
