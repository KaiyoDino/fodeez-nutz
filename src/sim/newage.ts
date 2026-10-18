// New Age mode: same map, same wheelchair, same plunger, rebuilt physics.
//
// - The plunger rope pulls: once it sticks, holding the mouse reels you toward the
//   plunger, faster the longer you hold. Your sideways momentum carries through the pull,
//   and the rope never stretches, so you swing when it goes taut. When you reach the
//   plunger it lets go and you fly on in the direction it pulled you. Letting go early
//   keeps your momentum and adds a small hop.
// - You can fire in any direction, not just upward. 3 grapples per airtime, refilled
//   by landing or by goop.
// - Smooth (fractional) speeds, a terminal falling speed, and damped landings.
// - Springs multiply your speed by 1.75 like the original, but always give at least a
//   small boing and never more than a fixed cap. A bounce off a pad puts you back to
//   rolling pace sideways and refills your grapples.
// - You ride moving platforms properly: your rolling is relative to the platform.
// - Goop holds you while you slowly slide off (15 px/s). After 160 ticks it lets go.

import { DUDE, type PlatformDef } from './level';
import type { DudeState, InputEvent, SimEvent, Surface } from './types';
import { GOOP_TICKS, MAX_GRAPPLES } from './types';
import { dudeOverlaps, isVisible, len, overlaps, platformBox, platformsOf, type Box, type WorldState } from './world';

export const NA = {
  gravity: 0.6,
  maxFall: 24,
  maxSpeed: 40,
  cruise: 3.6,
  driveAccel: 0.22,
  rollDrag: 0.1,
  floorBounce: 0.22,
  bounceThreshold: 5,
  wallBounce: 0.5,
  ceilingBounce: 0.3,
  springMult: 1.75,
  springMin: 9,
  springCap: 28,
  hookSpeed: 30,
  hookRange: 350,
  hookRadius: 6,
  /** Reel-in speed (px/tick toward the plunger): starts at reelStart and builds up to reelMax. */
  reelStart: 6,
  reelAccel: 0.5,
  reelMax: 16,
  /** How quickly the rope can change his speed toward the plunger (px/tick per tick). */
  pullAccel: 1.6,
  /** While reeling, the part of his speed across the rope keeps this much per tick, so he goes where he aimed instead of orbiting the plunger. */
  acrossKeep: 0.85,
  /** The plunger lets go once his hand is this close to it. */
  arriveDist: 40,
  attachTug: 2,
  releaseBoost: 3,
  autoReleaseAbove: 40,
  goopSlide: 0.25,
  /** Where the rope meets the dude, relative to his top-left. */
  hand: { x: 23, y: 18 },
} as const;

type Side = 'top' | 'bottom' | 'left' | 'right';

export interface NewAgeState {
  hook: {
    state: 'idle' | 'flying' | 'attached';
    x: number;
    y: number;
    vx: number;
    vy: number;
    traveled: number;
    /** Rope length while attached. */
    len: number;
    /** Platform index the plunger is stuck to. */
    target: number;
    held: number;
  };
  pressed: boolean;
  grapples: number;
  /** Platform he's standing on (-1 when airborne). */
  ground: number;
  stuck: { i: number; side: Side; ticks: number } | null;
  /** Goop that just let go of him can't grab him again until he leaves it. */
  noRegrab: number;
}

export function newNewAgeState(): NewAgeState {
  return {
    hook: { state: 'idle', x: 0, y: 0, vx: 0, vy: 0, traveled: 0, len: 0, target: -1, held: 0 },
    pressed: false,
    grapples: 0,
    ground: -1,
    stuck: null,
    noRegrab: -1,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const surfaceOf = (p: PlatformDef): Surface => {
  return p.kind === 'spring' ? 'spring' : p.kind === 'goop' ? 'goop' : p.mover ? 'mover' : 'girder';
};

/**
 * Spring pads (wider than tall) are one-way in New Age: you pass up through them from
 * below, and they still catch you from above. The pad under the gap into area 3 would
 * otherwise seal that gap from below.
 */
export const isOneWay = (p: PlatformDef): boolean => p.kind === 'spring' && p.w > p.h;

/** Solid for the dude: everything visible except plain targets. */
function isSolid(i: number, world: WorldState): boolean {
  const p = platformsOf(world)[i];
  if (!isVisible(p, world)) return false;
  if (p.kind === 'target') return p.role === 'troll';
  return true;
}

export function handOf(d: DudeState) {
  return { x: d.x + NA.hand.x, y: d.y + NA.hand.y };
}

/** Is this target's centre within letting-go distance of his hand? */
export function nearHand(d: DudeState, p: Box): boolean {
  const hand = handOf(d);
  return len(hand.x - (p.x + p.w / 2), hand.y - (p.y + p.h / 2)) <= NA.arriveDist;
}

function releaseHook(n: NewAgeState): void {
  n.hook.state = 'idle';
  n.hook.target = -1;
  n.hook.held = 0;
}

export function applyNewAgeInput(d: DudeState, n: NewAgeState, ev: InputEvent, events: SimEvent[]): void {
  if (ev.kind === 'press') {
    n.pressed = true;
    if (n.hook.state !== 'idle') return;
    const hand = handOf(d);
    const dx = ev.x - hand.x;
    const dy = ev.y - hand.y;
    const l = len(dx, dy);
    if (l < 1) return;
    if (n.grapples >= MAX_GRAPPLES) {
      events.push({ type: 'hookCancel', x: hand.x, y: hand.y, reason: 'spent' });
      return;
    }
    n.hook = { state: 'flying', x: hand.x, y: hand.y, vx: (dx / l) * NA.hookSpeed, vy: (dy / l) * NA.hookSpeed, traveled: 0, len: 0, target: -1, held: 0 };
    events.push({ type: 'hookFire', x: hand.x, y: hand.y });
  } else {
    n.pressed = false;
    if (n.hook.state === 'attached') {
      d.vy -= NA.releaseBoost;
      events.push({ type: 'hookRelease', x: n.hook.x, y: n.hook.y, auto: false });
    } else if (n.hook.state === 'flying') {
      events.push({ type: 'hookCancel', x: n.hook.x, y: n.hook.y, reason: 'released' });
    }
    releaseHook(n);
  }
}

/** Ping-pong the moving platforms between x and x + range. */
function moveMovers(world: WorldState): void {
  const L = platformsOf(world);
  for (let i = 0; i < L.length; i++) {
    const m = L[i].mover;
    if (!m) continue;
    let x = world.platX[i] + world.platDx[i];
    if (x > L[i].x + m.range) {
      x = L[i].x + m.range;
      world.platDx[i] = -m.speed;
    } else if (x < L[i].x) {
      x = L[i].x;
      world.platDx[i] = m.speed;
    }
    world.platX[i] = x;
  }
}

interface Ctx {
  L: readonly PlatformDef[];
  d: DudeState;
  n: NewAgeState;
  world: WorldState;
  events: SimEvent[];
  won: boolean;
  landed: boolean;
  /** Speed of each platform this tick (after reversal). */
  pdx: number[];
}

function stick(c: Ctx, i: number, side: Side, p: Box): void {
  const { d, n } = c;
  if (d.vx !== 0 && (side === 'top' || side === 'bottom')) d.facing = d.vx > 0 ? 1 : -1;
  d.vx = 0;
  d.vy = 0;
  n.stuck = { i, side, ticks: 0 };
  n.ground = -1;
  n.grapples = 0;
  if (n.hook.state === 'attached') {
    releaseHook(n);
    c.events.push({ type: 'hookRelease', x: n.hook.x, y: n.hook.y, auto: true });
  }
  const ex = side === 'left' ? p.x : side === 'right' ? p.x + p.w : d.x + DUDE.w / 2;
  const ey = side === 'top' ? p.y : side === 'bottom' ? p.y + p.h : d.y + DUDE.h / 2;
  c.events.push({ type: 'goopStick', x: ex, y: ey, side });
}

function resolveX(c: Ctx): void {
  const { d, n, world, L } = c;
  for (let i = 0; i < L.length; i++) {
    if (!isSolid(i, world) || isOneWay(L[i])) continue;
    const p = platformBox(world, i);
    if (!dudeOverlaps(d.x, d.y, p)) continue;
    const def = L[i];
    if (def.kind === 'goal') {
      c.won = true;
      continue;
    }
    const pv = c.pdx[i];
    const rel = d.vx - pv;
    const hitLeftSide = rel !== 0 ? rel > 0 : d.x + DUDE.w / 2 < p.x + p.w / 2;
    d.x = hitLeftSide ? p.x - DUDE.w : p.x + p.w;
    const speed = Math.abs(rel);
    const away = hitLeftSide ? -1 : 1;
    if (def.kind === 'goop' && n.noRegrab !== i) {
      stick(c, i, hitLeftSide ? 'left' : 'right', p);
      return;
    }
    if (def.kind === 'spring') {
      const out = clamp(speed * NA.springMult, NA.springMin, NA.springCap);
      d.vx = pv + away * out;
      d.facing = away as 1 | -1;
      c.events.push({ type: 'spring', speed, x: hitLeftSide ? p.x : p.x + p.w, y: d.y + DUDE.h / 2, axis: 'x' });
    } else {
      const bounce = def.kind === 'goop' ? 0 : NA.wallBounce;
      d.vx = pv + away * speed * bounce;
      d.facing = away as 1 | -1;
      if (speed > 2) c.events.push({ type: 'bump', speed, x: hitLeftSide ? p.x : p.x + p.w, y: d.y + DUDE.h / 2, axis: 'x', surface: surfaceOf(L[i]) });
    }
  }
}

function resolveY(c: Ctx, prevY: number): void {
  const { d, n, world, L } = c;
  for (let i = 0; i < L.length; i++) {
    if (!isSolid(i, world)) continue;
    const p = platformBox(world, i);
    if (!dudeOverlaps(d.x, d.y, p)) continue;
    if (isOneWay(L[i]) && (d.vy < 0 || prevY + DUDE.h > p.y + 0.5)) continue;
    const def = L[i];
    if (def.kind === 'goal') {
      c.won = true;
      continue;
    }
    const down = d.vy > 0 || (d.vy === 0 && d.y + DUDE.h / 2 < p.y + p.h / 2);
    const speed = Math.abs(d.vy);
    if (down) {
      d.y = p.y - DUDE.h;
      if (def.kind === 'goop' && n.noRegrab !== i) {
        stick(c, i, 'top', p);
        return;
      }
      if (def.kind === 'spring') {
        d.vy = -clamp(speed * NA.springMult, NA.springMin, NA.springCap);
        // His wheels touch the pad, so he goes back to rolling pace: pads bounce you up, not
        // sideways, and he can't bounce in place forever either.
        let rel = d.vx - c.pdx[i];
        if (rel !== 0) d.facing = rel > 0 ? 1 : -1;
        rel = d.facing * Math.min(NA.cruise, Math.max(Math.abs(rel), 1));
        d.vx = c.pdx[i] + rel;
        // a bounce counts as touching down: the grapples refill (as in the original)
        n.grapples = 0;
        c.events.push({ type: 'spring', speed, x: d.x + DUDE.w / 2, y: p.y, axis: 'y' });
        continue;
      }
      if (speed > NA.bounceThreshold) d.vy = -speed * NA.floorBounce;
      else d.vy = 0;
      n.ground = i;
      n.grapples = 0;
      c.landed = true;
      if (speed > 3) c.events.push({ type: 'land', speed, x: d.x + DUDE.w / 2, y: p.y, surface: surfaceOf(L[i]) });
    } else {
      d.y = p.y + p.h;
      if (def.kind === 'goop' && n.noRegrab !== i) {
        stick(c, i, 'bottom', p);
        return;
      }
      if (def.kind === 'spring') {
        d.vy = clamp(speed * NA.springMult, NA.springMin * 0.5, NA.springCap);
        c.events.push({ type: 'spring', speed, x: d.x + DUDE.w / 2, y: p.y + p.h, axis: 'y' });
      } else {
        d.vy = speed * (def.kind === 'goop' ? 0 : NA.ceilingBounce);
        if (speed > 2) c.events.push({ type: 'bump', speed, x: d.x + DUDE.w / 2, y: p.y + p.h, axis: 'y', surface: surfaceOf(L[i]) });
      }
    }
  }
}

/** Is the dude still against goop i on the given side? */
function touching(d: DudeState, p: Box, side: Side): boolean {
  if (side === 'left' || side === 'right') return d.y + DUDE.h > p.y && d.y < p.y + p.h;
  return d.x + DUDE.w > p.x && d.x < p.x + p.w;
}

function blockedAnywhere(d: DudeState, world: WorldState, except: number): boolean {
  const L = platformsOf(world);
  for (let i = 0; i < L.length; i++) {
    if (i === except || !isSolid(i, world) || L[i].kind === 'goal') continue;
    if (dudeOverlaps(d.x, d.y, platformBox(world, i))) return true;
  }
  return false;
}

function updateStuck(c: Ctx): void {
  const { d, n, world } = c;
  const s = n.stuck!;
  const p = platformBox(world, s.i);
  // carried by moving goop
  d.x += c.pdx[s.i];
  s.ticks++;
  const before = { x: d.x, y: d.y };
  if (s.side === 'left' || s.side === 'right') d.y += NA.goopSlide;
  else d.x += d.facing * NA.goopSlide;
  if (blockedAnywhere(d, world, s.i)) {
    d.x = before.x;
    d.y = before.y;
  }
  const letGo = s.ticks >= GOOP_TICKS;
  if (letGo || !touching(d, p, s.side)) {
    n.stuck = null;
    if (letGo) {
      n.noRegrab = s.i;
      c.events.push({ type: 'goopLetGo', x: d.x + DUDE.w / 2, y: d.y + DUDE.h / 2 });
    }
    d.vx = c.pdx[s.i];
    d.vy = 0;
    if (s.side === 'top') d.vx += d.facing * NA.cruise * 0.5;
    if (s.side === 'left') d.vx -= 0.5;
    if (s.side === 'right') d.vx += 0.5;
  }
}

function updateHook(c: Ctx): void {
  const { d, n, world, L } = c;
  const h = n.hook;
  if (h.state === 'flying') {
    const steps = 3;
    for (let k = 0; k < steps && h.state === 'flying'; k++) {
      h.x += h.vx / steps;
      h.y += h.vy / steps;
      h.traveled += NA.hookSpeed / steps;
      for (let i = 0; i < L.length; i++) {
        const def = L[i];
        if (!isVisible(def, world) || def.kind === 'goal' || isOneWay(L[i])) continue;
        const p = platformBox(world, i);
        if (!overlaps(h.x - NA.hookRadius, h.y - NA.hookRadius, NA.hookRadius * 2, NA.hookRadius * 2, p)) continue;
        // A target right at his hand can't be grabbed (the rope would let go at once), so the
        // plunger flies on past it. This matters when he's stuck on goop beside a target.
        if (def.kind === 'target' && nearHand(d, p)) continue;
        if (def.kind === 'target') {
          if (n.grapples >= MAX_GRAPPLES) {
            releaseHook(n);
            c.events.push({ type: 'hookCancel', x: h.x, y: h.y, reason: 'spent' });
            break;
          }
          h.state = 'attached';
          h.target = i;
          h.x = p.x + p.w / 2;
          h.y = p.y + p.h / 2;
          h.held = 0;
          const hand = handOf(d);
          h.len = len(hand.x - h.x, hand.y - h.y);
          n.grapples++;
          if (n.stuck) {
            n.noRegrab = n.stuck.i;
            n.stuck = null;
          }
          n.ground = -1;
          // a tug toward the plunger to start the swing
          const dx = h.x - hand.x;
          const dy = h.y - hand.y;
          const l = len(dx, dy) || 1;
          d.vx += (dx / l) * NA.attachTug;
          d.vy += (dy / l) * NA.attachTug;
          c.events.push({ type: 'hookAttach', x: h.x, y: h.y });
        } else {
          releaseHook(n);
          c.events.push({ type: 'hookCancel', x: h.x, y: h.y, reason: 'blocked' });
        }
        break;
      }
      if (h.state === 'flying' && h.traveled >= NA.hookRange) {
        releaseHook(n);
        c.events.push({ type: 'hookCancel', x: h.x, y: h.y, reason: 'range' });
      }
    }
  } else if (h.state === 'attached') {
    // The troll target vanishes once you're above the floor; the plunger loses its grip.
    if (!isVisible(L[h.target], world)) {
      releaseHook(n);
      c.events.push({ type: 'hookRelease', x: h.x, y: h.y, auto: true });
      return;
    }
    const hand = handOf(d);
    // arrived (or swung up over the top): let go and fly on
    if (len(hand.x - h.x, hand.y - h.y) <= NA.arriveDist || hand.y < h.y - NA.autoReleaseAbove) {
      releaseHook(n);
      c.events.push({ type: 'hookRelease', x: h.x, y: h.y, auto: true });
    }
  }
}

/**
 * The rope while held. His velocity splits into a part toward the plunger and a part across
 * the rope. The across part (his old momentum, and gravity's swing) fades a little each tick,
 * so the pull wins and carries him through the plunger instead of around it. The toward part
 * is driven up to the reel speed, which builds the longer he holds. The rope never gets
 * longer, so if it's taut he can't move away from the plunger: he swings instead.
 */
function applyRope(c: Ctx): void {
  const { d, n } = c;
  const h = n.hook;
  if (h.state !== 'attached') return;
  h.held++;
  const hand = handOf(d);
  const dx = h.x - hand.x;
  const dy = h.y - hand.y;
  const dist = len(dx, dy);
  if (dist < 1) return;
  const ux = dx / dist;
  const uy = dy / dist;
  let toward = d.vx * ux + d.vy * uy;
  const acrossX = (d.vx - toward * ux) * NA.acrossKeep;
  const acrossY = (d.vy - toward * uy) * NA.acrossKeep;
  h.len = Math.min(h.len, dist);
  if (toward < 0 && dist >= h.len - 0.5) toward = 0;
  const reel = Math.min(NA.reelMax, NA.reelStart + NA.reelAccel * h.held);
  if (toward < reel) toward = Math.min(reel, toward + NA.pullAccel);
  d.vx = acrossX + toward * ux;
  d.vy = acrossY + toward * uy;
}

export interface NewAgeTickResult {
  won: boolean;
  landed: boolean;
}

export function stepNewAge(d: DudeState, n: NewAgeState, world: WorldState, events: SimEvent[]): NewAgeTickResult {
  const oldDx = world.platDx.slice();
  moveMovers(world);
  const L = platformsOf(world);
  const c: Ctx = { L, d, n, world, events, won: false, landed: false, pdx: world.platDx };

  if (n.noRegrab >= 0) {
    const p = platformBox(world, n.noRegrab);
    if (!overlaps(d.x - 2, d.y - 2, DUDE.w + 4, DUDE.h + 4, p)) n.noRegrab = -1;
  }

  if (n.stuck) {
    updateStuck(c);
    updateHook(c);
    if (n.stuck) {
      c.landed = true;
      return { won: c.won, landed: true };
    }
    if (n.hook.state !== 'attached') return { won: c.won, landed: false };
  }

  const ground = n.ground;
  n.ground = -1;
  // stay synced with a moving platform when it turns around (as if the wheels grip)
  if (ground >= 0 && L[ground].mover) d.vx += world.platDx[ground] - oldDx[ground];

  d.vy += NA.gravity;

  if (ground >= 0 && n.hook.state !== 'attached') {
    const pv = world.platDx[ground];
    let rel = d.vx - pv;
    if (rel !== 0) d.facing = rel > 0 ? 1 : -1;
    const dir = d.facing;
    const along = rel * dir;
    if (along < NA.cruise) rel += dir * Math.min(NA.driveAccel, NA.cruise - along);
    else if (along > NA.cruise) rel -= dir * Math.min(NA.rollDrag, along - NA.cruise);
    d.vx = pv + rel;
  }

  applyRope(c);

  if (n.hook.state !== 'attached') d.vy = Math.min(d.vy, NA.maxFall);
  const speed = len(d.vx, d.vy);
  if (speed > NA.maxSpeed) {
    d.vx *= NA.maxSpeed / speed;
    d.vy *= NA.maxSpeed / speed;
  }

  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(d.vx), Math.abs(d.vy)) / 8));
  for (let k = 0; k < steps && !n.stuck; k++) {
    d.x += d.vx / steps;
    resolveX(c);
    if (n.stuck) break;
    const prevY = d.y;
    d.y += d.vy / steps;
    resolveY(c, prevY);
  }

  updateHook(c);

  if (!n.stuck && n.ground < 0 && Math.abs(d.vx) > 0.5) d.facing = d.vx > 0 ? 1 : -1;
  return { won: c.won, landed: c.landed || !!n.stuck };
}
