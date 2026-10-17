// Original mode: a line-by-line port of MainFrame.actionPerformed and the mouse
// handlers from the 2023 Java game. Variable names follow the original so the two
// can be read side by side. Everything is integer math, like the Java ints.
//
// Deliberate fixes (see README "Original mode"):
//  - Movement is split into sub-steps of at most 48 px, so nothing tunnels through a
//    platform at high speed. At normal speeds it's a single step, identical to the original.
//  - Starting to roll from a standstill picks left or right at random. The original's
//    (int)(Math.random()*2)-1 could only produce -1 or 0, so it always went left.
//  - The release boost only applies if the hook actually caught during this press. The
//    original tested hook.dy == 0, which was also true for a leftover hook, so a quick
//    click gave a free mid-air boost.
//  - The hook ignores platforms that are currently invisible, instead of the original's
//    hard-coded exceptions for list positions 31 and 50.
//  - A moving girder that pushes a stationary dude pushes him out of the side it came
//    from, instead of sometimes teleporting him through to the other side.
//
// Kept on purpose, including the odd bits: reversed gravity while hooked, spring bounces
// that multiply by 1.75 with no cap, riding moving girders at platform speed + 2, the goop
// timer that sends you back to the start, and the extra tick of reversed gravity after an
// auto-release.

import { DUDE, GOOP_RESET, LEVEL } from './level';
import { nextRandom } from './rng';
import type { DudeState, InputEvent, SimEvent, Surface } from './types';
import { GOOP_TICKS, MAX_GRAPPLES } from './types';
import { dudeOverlaps, isVisible, overlaps, platformBox, type WorldState } from './world';

export interface OriginalState {
  gravity: number;
  wantsHook: boolean;
  goHook: boolean;
  trackMouse: boolean;
  /** Replaces the original's `hook.getDy() == 0` test for "the hook has caught". */
  attached: boolean;
  mouseX: number;
  mouseY: number;
  hookX: number;
  hookY: number;
  hookDx: number;
  hookDy: number;
  collidedFloor: boolean;
  onMoving: boolean;
  onSticky: boolean;
  reversed: boolean;
  reversedSticky: boolean;
  dying: number;
  grapples: number;
  /** Not in the original: which side of the goop he's stuck to, for drawing. */
  stuckSide: 'top' | 'bottom' | 'left' | 'right' | null;
  /** Not in the original: standing on top of static goop, which stops him dead but never starts the goop timer. */
  onGoopTop: boolean;
}

export const HOOK_SIZE = 20;
export const HOOK_SPEED = 30;
export const HOOK_RANGE = 350;
/** Java's (int) cast: truncate toward zero (and never produce -0). */
const ti = (v: number): number => Math.trunc(v) + 0;
const MAX_STEP = 48;
/** Not a gameplay cap: just keeps a runaway number from ever freezing the game. */
const SANITY_SPEED = 2000;

export function newOriginalState(dude: DudeState): OriginalState {
  return {
    gravity: 1,
    wantsHook: false,
    goHook: true,
    trackMouse: true,
    attached: false,
    mouseX: 0,
    mouseY: 0,
    hookX: dude.x - 20,
    hookY: dude.y - 20,
    hookDx: 0,
    hookDy: 0,
    collidedFloor: false,
    onMoving: false,
    onSticky: false,
    reversed: false,
    reversedSticky: false,
    dying: 0,
    grapples: 0,
    stuckSide: null,
    onGoopTop: false,
  };
}

/** The original's platform type numbers: 0 no collision, 1 normal, 2 bouncy, 3 sticky, 4-6 moving versions, 7 finish. */
export function originalType(i: number, world: WorldState): number {
  const p = LEVEL[i];
  if (!isVisible(p, world)) return 0;
  switch (p.kind) {
    case 'target':
      // The troll target was switched to type 1 (solid) while visible.
      return p.role === 'troll' ? 1 : 0;
    case 'girder':
      return p.mover ? 4 : 1;
    case 'spring':
      return p.mover ? 5 : 2;
    case 'goop':
      return p.mover ? 6 : 3;
    case 'goal':
      return 7;
  }
}

const surfaceOf = (type: number): Surface => (type === 2 || type === 5 ? 'spring' : type === 3 || type === 6 ? 'goop' : type === 4 ? 'mover' : 'girder');

interface Ctx {
  d: DudeState;
  o: OriginalState;
  world: WorldState;
  rng: { rng: number };
  events: SimEvent[];
  won: boolean;
  collided: boolean;
}

/** Apply mouse events. In Java these ran on the event thread between timer ticks. */
export function applyOriginalInput(d: DudeState, o: OriginalState, ev: InputEvent, events: SimEvent[]): void {
  if (ev.kind === 'press') {
    // mousePressed: only fires if the click is more than 25 px above the dude
    if (d.y > ev.y + 25) o.wantsHook = true;
    o.mouseX = ti(ev.x);
    o.mouseY = ti(ev.y);
  } else {
    // mouseReleased
    if (o.wantsHook && o.attached) {
      d.vx = ti(d.vx / 2);
      d.vy = d.vy - 10;
      o.grapples++;
      events.push({ type: 'hookRelease', x: o.hookX + HOOK_SIZE / 2, y: o.hookY + HOOK_SIZE / 2, auto: false });
    } else if (o.wantsHook && !o.trackMouse) {
      events.push({ type: 'hookCancel', x: o.hookX + HOOK_SIZE / 2, y: o.hookY + HOOK_SIZE / 2, reason: 'released' });
    }
    o.wantsHook = false;
    o.attached = false;
    o.goHook = true;
    o.trackMouse = true;
    o.gravity = 1;
  }
}

function friction(c: Ctx): void {
  const d = c.d;
  if (d.vx >= 4) d.vx--;
  else if (d.vx <= -4) d.vx++;
  else if (d.vx < 0) d.vx--;
  else if (d.vx > 0) d.vx++;
  else d.vx = nextRandom(c.rng) < 0.5 ? -1 : 1;
}

function dropHook(o: OriginalState): void {
  o.wantsHook = false;
  o.attached = false;
}

/** One pass of the original's vertical collision loop. Returns true if any collision response moved the dude. */
function verticalPass(c: Ctx): boolean {
  const { d, o, world } = c;
  let responded = false;
  for (let i = 0; i < LEVEL.length; i++) {
    const type = originalType(i, world);
    if (type === 0) continue;
    const p = platformBox(world, i);
    if (!dudeOverlaps(d.x, d.y, p)) continue;
    c.collided = true;
    const incoming = d.vy;
    switch (type) {
      case 1:
      case 2: {
        o.onMoving = false;
        if (d.vy > 0) {
          o.grapples = 0;
          friction(c);
          o.collidedFloor = true;
          d.y = p.y - DUDE.h;
          d.vy = ti(-d.vy * (type === 1 ? 0.3 : 1.75));
          responded = true;
          if (type === 2) c.events.push({ type: 'spring', speed: incoming, x: d.x + DUDE.w / 2, y: p.y, axis: 'y' });
          else if (incoming >= 3) c.events.push({ type: 'land', speed: incoming, x: d.x + DUDE.w / 2, y: p.y, surface: 'girder' });
        }
        break;
      }
      case 3:
        o.onMoving = false;
        if (d.vy > 0) {
          o.grapples = 0;
          o.collidedFloor = true;
          d.y = p.y - DUDE.h;
          d.vy = 0;
          d.vx = 0;
          o.onGoopTop = true;
          responded = true;
          // Landing on top of static goop stops him dead, but the original never set onSticky here.
          if (incoming >= 3) c.events.push({ type: 'goopStick', x: d.x + DUDE.w / 2, y: p.y, side: 'top' });
        }
        break;
      case 4:
      case 5:
        if (d.vy > 0) {
          o.grapples = 0;
          o.collidedFloor = true;
          d.y = p.y - DUDE.h;
          d.vy = ti(-d.vy * (type === 4 ? 0.3 : 1.75));
          if (!o.onMoving) {
            const pdx = world.platDx[i];
            d.vx = pdx < 0 ? pdx - 2 : pdx + 2;
          }
          if (o.reversed) d.vx = -d.vx;
          o.onMoving = true;
          responded = true;
          if (incoming >= 3) c.events.push({ type: 'land', speed: incoming, x: d.x + DUDE.w / 2, y: p.y, surface: surfaceOf(type) });
        }
        break;
      case 6:
        if (d.vy > 0) {
          if (!o.onSticky) c.events.push({ type: 'goopStick', x: d.x + DUDE.w / 2, y: p.y, side: 'top' });
          o.onSticky = true;
          o.stuckSide = 'top';
          o.grapples = 0;
          o.collidedFloor = true;
          d.y = p.y - DUDE.h;
          d.vx = world.platDx[i];
          d.vy = 0;
          o.onMoving = true;
          responded = true;
        }
        break;
      case 7:
        c.won = true;
        break;
    }
    if (d.vy < 0 && !o.collidedFloor) {
      // hitting the bottom of stuff
      const up = d.vy;
      switch (type) {
        case 1:
        case 4:
          d.y = p.y + p.h;
          d.vy = ti(-d.vy * 0.3);
          responded = true;
          if (up <= -3) c.events.push({ type: 'bump', speed: -up, x: d.x + DUDE.w / 2, y: p.y + p.h, axis: 'y', surface: surfaceOf(type) });
          break;
        case 2:
        case 5:
          d.y = p.y + p.h;
          d.vy = ti(-d.vy * 1.75);
          responded = true;
          c.events.push({ type: 'spring', speed: -up, x: d.x + DUDE.w / 2, y: p.y + p.h, axis: 'y' });
          break;
        case 3:
          o.grapples = 0;
          dropHook(o);
          if (!o.onSticky) c.events.push({ type: 'goopStick', x: d.x + DUDE.w / 2, y: p.y + p.h, side: 'bottom' });
          o.onSticky = true;
          o.stuckSide = 'bottom';
          d.y = p.y + p.h;
          d.vy = 0;
          d.vx = 0;
          responded = true;
          break;
        case 6:
          o.grapples = 0;
          if (!o.onSticky) c.events.push({ type: 'goopStick', x: d.x + DUDE.w / 2, y: p.y + p.h, side: 'bottom' });
          o.onSticky = true;
          o.stuckSide = 'bottom';
          d.y = p.y + p.h;
          d.vx = world.platDx[i];
          d.vy = 0;
          o.onMoving = true;
          responded = true;
          break;
      }
    }
  }
  return responded;
}

function reverseDirection(world: WorldState, i: number): boolean {
  const p = LEVEL[i];
  const x = world.platX[i];
  if (x > p.x + p.mover!.range || x < p.x) {
    world.platDx[i] *= -1;
    return true;
  }
  return false;
}

/**
 * Push the dude back out of the side he hit (the original's moveBack dance). The original
 * picked the side from the dude's own speed, which is right for walls that stand still. The
 * fix uses his speed relative to the platform, so a moving girder can never shove him
 * through to its far side. Against a still wall it's identical.
 */
function pushOut(d: DudeState, p: { x: number; w: number }, platformDx: number): void {
  const relative = d.vx - platformDx;
  const left = relative !== 0 ? relative > 0 : d.x + DUDE.w / 2 < p.x + p.w / 2;
  d.vx = -d.vx; // invert X
  d.x += d.vx; // update x once to get out of object
  const moveBack = left ? d.x + DUDE.w - p.x : d.x - (p.x + p.w);
  d.x -= moveBack;
}

/** One pass of the original's horizontal loop. Platforms only move on the first pass of a tick. */
function horizontalPass(c: Ctx, movePlatforms: boolean): boolean {
  const { d, o, world } = c;
  let responded = false;
  for (let i = 0; i < LEVEL.length; i++) {
    let type = originalType(i, world);
    if (movePlatforms && (type === 4 || type === 5 || type === 6)) {
      if (type === 6) o.reversedSticky = reverseDirection(world, i);
      else o.reversed = reverseDirection(world, i);
      if (o.reversedSticky && o.onMoving && o.onSticky) {
        d.vx = -d.vx;
        d.x = d.x + d.vx + d.vx;
      }
      world.platX[i] += world.platDx[i];
      type = originalType(i, world);
    }
    if (type === 0) continue;
    const p = platformBox(world, i);
    if (!dudeOverlaps(d.x, d.y, p)) continue;
    c.collided = true;
    const pdx = world.platDx[i];
    const incoming = Math.abs(d.vx);
    switch (type) {
      case 1:
      case 4:
        pushOut(d, p, pdx);
        d.vx = ti(d.vx * 0.4);
        while (d.vx < pdx && pdx > 0) d.vx++;
        while (d.vx > pdx && pdx < 0) d.vx--;
        responded = true;
        if (incoming >= 3) c.events.push({ type: 'bump', speed: incoming, x: d.vx > 0 ? d.x : d.x + DUDE.w, y: d.y + DUDE.h / 2, axis: 'x', surface: surfaceOf(type) });
        break;
      case 2:
      case 5:
        pushOut(d, p, pdx);
        d.vx = ti(d.vx * 1.75);
        responded = true;
        c.events.push({ type: 'spring', speed: incoming, x: d.vx > 0 ? d.x : d.x + DUDE.w, y: d.y + DUDE.h / 2, axis: 'x' });
        break;
      case 3: {
        o.grapples = 0;
        dropHook(o);
        const wasStuck = o.onSticky;
        o.onSticky = true;
        pushOut(d, p, pdx);
        o.stuckSide = d.x >= p.x + p.w ? 'right' : 'left';
        d.vx = 0;
        d.vy = 0;
        responded = true;
        if (!wasStuck) c.events.push({ type: 'goopStick', x: o.stuckSide === 'right' ? d.x : d.x + DUDE.w, y: d.y + DUDE.h / 2, side: o.stuckSide });
        break;
      }
      case 6: {
        o.grapples = 0;
        const wasStuck = o.onSticky;
        o.onSticky = true;
        pushOut(d, p, pdx);
        o.stuckSide = d.x >= p.x + p.w ? 'right' : 'left';
        d.vx = pdx;
        d.vy = 0;
        o.onMoving = true;
        responded = true;
        if (!wasStuck) c.events.push({ type: 'goopStick', x: o.stuckSide === 'right' ? d.x : d.x + DUDE.w, y: d.y + DUDE.h / 2, side: o.stuckSide });
        break;
      }
    }
  }
  return responded;
}

function hookOverlaps(o: OriginalState, b: { x: number; y: number; w: number; h: number }): boolean {
  return overlaps(o.hookX, o.hookY, HOOK_SIZE, HOOK_SIZE, b);
}

/** The original's hook collision loop, run after each axis of hook movement. */
function hookPass(c: Ctx): void {
  const { o, world } = c;
  for (let i = 0; i < LEVEL.length; i++) {
    const def = LEVEL[i];
    // Fix: invisible platforms and the goal never touch the hook (the original special-cased indices 31 and 50).
    if (!isVisible(def, world) || def.kind === 'goal') continue;
    if (!hookOverlaps(o, platformBox(world, i))) continue;
    if (def.kind === 'target' && o.grapples < MAX_GRAPPLES) {
      o.hookDx = 0;
      o.hookDy = 0;
      if (o.wantsHook && !o.attached) {
        o.attached = true;
        c.events.push({ type: 'hookAttach', x: o.hookX + HOOK_SIZE / 2, y: o.hookY + HOOK_SIZE / 2 });
      }
    } else if (o.wantsHook) {
      dropHook(o);
      c.events.push({ type: 'hookCancel', x: o.hookX + HOOK_SIZE / 2, y: o.hookY + HOOK_SIZE / 2, reason: def.kind === 'target' ? 'spent' : 'blocked' });
    }
  }
}

function trackMouse(o: OriginalState): void {
  const clickDistanceX = o.mouseX - o.hookX;
  const clickDistanceY = o.mouseY - o.hookY;
  const angle = Math.atan(clickDistanceY / clickDistanceX);
  const sign = o.mouseX < o.hookX ? -1 : 1;
  o.hookDx = sign * HOOK_SPEED * Math.cos(angle);
  o.hookDy = sign * HOOK_SPEED * Math.sin(angle);
}

/** Integer sub-steps that add up to `total`, none longer than MAX_STEP. */
function substeps(total: number): number[] {
  const k = Math.max(1, Math.ceil(Math.abs(total) / MAX_STEP));
  const out: number[] = [];
  let done = 0;
  for (let i = 1; i <= k; i++) {
    const next = Math.round((total * i) / k);
    out.push(next - done);
    done = next;
  }
  return out;
}

export interface OriginalTickResult {
  won: boolean;
  /** True if he landed on something this tick (for fall tracking). */
  landed: boolean;
}

export function stepOriginal(d: DudeState, o: OriginalState, world: WorldState, rng: { rng: number }, events: SimEvent[]): OriginalTickResult {
  const c: Ctx = { d, o, world, rng, events, won: false, collided: false };

  if (o.onSticky) o.dying++;
  else o.dying = 0;
  if (o.dying === GOOP_TICKS) {
    events.push({ type: 'goopReset', x: d.x, y: d.y });
    d.x = GOOP_RESET.x;
    d.y = GOOP_RESET.y;
    o.onSticky = false;
    o.stuckSide = null;
    o.dying = 0;
  }

  d.vy += o.gravity;
  c.collided = false;
  o.collidedFloor = false;
  o.onGoopTop = false;

  if (o.onSticky) d.vy = 0;

  d.vy = Math.max(-SANITY_SPEED, Math.min(SANITY_SPEED, d.vy));
  d.vx = Math.max(-SANITY_SPEED, Math.min(SANITY_SPEED, d.vx));

  // move y and check for vertical collision
  for (const step of substeps(d.vy)) {
    d.y += step;
    if (verticalPass(c)) break;
  }

  // move x, move the moving platforms, and check for horizontal collision
  let first = true;
  for (const step of substeps(d.vx)) {
    d.x += step;
    const responded = horizontalPass(c, first);
    first = false;
    if (responded) break;
  }
  if (!c.collided && !o.onSticky) o.onMoving = false;
  if (!o.onSticky) o.stuckSide = null;

  // hook
  if (o.wantsHook) {
    if (o.trackMouse) {
      trackMouse(o);
      o.trackMouse = false;
      events.push({ type: 'hookFire', x: o.hookX + HOOK_SIZE / 2, y: o.hookY + HOOK_SIZE / 2 });
    }
    o.hookX = ti(o.hookX + o.hookDx);
    hookPass(c);
    o.hookY = ti(o.hookY + o.hookDy);
    hookPass(c);
    if (o.wantsHook && !o.attached && Math.hypot(o.hookX - d.x, o.hookY - d.y) > HOOK_RANGE) {
      o.wantsHook = false;
      o.goHook = true;
      o.trackMouse = true;
      events.push({ type: 'hookCancel', x: o.hookX + HOOK_SIZE / 2, y: o.hookY + HOOK_SIZE / 2, reason: 'range' });
    }
  } else {
    o.attached = false;
    o.hookX = d.x + 14;
    o.hookY = d.y - 20;
  }

  // the pull
  if (o.wantsHook && o.attached) {
    o.onSticky = false;
    o.stuckSide = null;
    if (o.goHook) {
      d.vy = -2;
      d.y = d.y - 10;
      o.gravity = -1;
      const distanceX = Math.abs(o.hookX - d.x);
      d.vx = o.mouseX >= d.x ? ti(distanceX / 9) : -ti(distanceX / 9);
      o.goHook = false;
    }
    if (d.y < o.hookY - 50) {
      o.grapples++;
      dropHook(o);
      d.vx = ti(d.vx / 2);
      events.push({ type: 'hookRelease', x: o.hookX + HOOK_SIZE / 2, y: o.hookY + HOOK_SIZE / 2, auto: true });
    }
  } else {
    o.gravity = 1;
  }

  if (d.vx !== 0) d.facing = d.vx > 0 ? 1 : -1;
  return { won: c.won, landed: o.collidedFloor || o.onSticky };
}
