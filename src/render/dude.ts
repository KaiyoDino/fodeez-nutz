// The dude: a 23x25 pixel sprite (one pixel = 2 world units, so it matches his 46x50
// hitbox). Body and chair are hand-placed pixels; the wheel spokes and the gun arm are
// drawn procedurally so they can turn.

import { P } from './palette';
import { dot, makeCanvas, type Ctx } from './px';

const KEY: Record<string, string> = {
  P: P.y1, O: P.o1, o: P.o0, H: P.hair, S: P.skin, s: P.skinS, E: P.ink, B: P.b1, b: P.b0, L: P.b2,
  N: P.n1, n: P.n0, W: P.white, R: P.r1, Y: P.y1, y: P.y0, D: P.s1, G: P.s0, g: P.s3,
};

// Facing right. '.' is empty.
const BODY = [
  '..........P............',
  '........OOOOO..........',
  '.......OOOOOOO.........',
  '.......oooooooo........',
  '.......HSSSSESS........',
  '.......HSSSSSSSS.......',
  '........sSSSSsS........',
  '..YYY....sSSS..........',
  '....Y.bbBBBBB..........',
  '....YDbBBBBBBL.........',
  '....YDbBBBBBBB.........',
  '....YDbBBBBBBB.........',
  '....YDbBBBBBBB.........',
  '....YDbbBBBBBB.........',
  '....YDNNNNNNNNNNNN.....',
  '....YYNNNNNNNNNNNN.....',
  '....YYYYYYYYYYYyNNN....',
  '...............yNNN....',
  '................YNNN...',
  '................YWWWWW.',
  '................YRRRRR.',
  '................YYYYYY.',
  '...................G...',
  '..................GgG..',
  '...................G...',
];

export const SPRITE_W = 23;
export const SPRITE_H = 25;
const WHEEL = { x: 8, y: 18, r: 6.4 };
export const SHOULDER = { x: 9, y: 10 };
/** Distance along the arm from the shoulder to the gun's muzzle, in sprite pixels. */
export const MUZZLE_REACH = 9;

export interface DudePose {
  facing: 1 | -1;
  /** Wheel rotation, radians. */
  wheel: number;
  /** World-space angle the gun points at (atan2), or null for the resting pose. */
  aim: number | null;
  /** Plunger loaded in the gun. */
  loaded: boolean;
  stuck: boolean;
  /** Seconds, for little animations. */
  t: number;
}

/** Local (facing-right) arm angle for a world-space aim angle. */
export function localAim(facing: 1 | -1, aim: number | null): number {
  if (aim === null) return -0.25;
  return facing > 0 ? aim : Math.PI - aim;
}

let scratch: HTMLCanvasElement | null = null;

/** Compose the sprite (with a 1 px outline) into a 25x27 canvas, facing right. */
export function buildDude(pose: DudePose): HTMLCanvasElement {
  const grid: (string | null)[][] = BODY.map(row => row.split('').map(ch => (ch === '.' ? null : KEY[ch])));
  const mask: boolean[][] = grid.map(row => row.map(c => c !== null));
  const set = (x: number, y: number, c: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < SPRITE_W && y < SPRITE_H) {
      grid[y][x] = c;
      mask[y][x] = true;
    }
  };

  // wheel: tire, rim, three spokes through the hub
  for (let y = 0; y < SPRITE_H; y++)
    for (let x = 0; x < SPRITE_W; x++) {
      const d = Math.hypot(x - WHEEL.x, y - WHEEL.y);
      if (d < WHEEL.r) mask[y][x] = true;
      if (d >= 5.3 && d < WHEEL.r) grid[y][x] = P.s0;
      else if (d >= 3.5 && d < 4.4) grid[y][x] = P.s3;
    }
  for (let k = 0; k < 3; k++) {
    const a = pose.wheel + (k * Math.PI) / 3;
    for (let r = -3; r <= 3; r++) if (r) set(WHEEL.x + Math.cos(a) * r, WHEEL.y + Math.sin(a) * r, P.s2);
  }
  set(WHEEL.x, WHEEL.y, P.y1);

  // the arm goes behind the head: never paint over head pixels
  const arm = (x: number, y: number, c: string) => {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (Y >= 0 && Y <= 7 && X >= 6 && X < SPRITE_W && BODY[Y][X] !== '.') return;
    set(X, Y, c);
  };
  const a = localAim(pose.facing, pose.aim);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const px = -sa;
  const py = ca;
  for (let i = 0; i <= 4; i++) {
    arm(SHOULDER.x + ca * i, SHOULDER.y + sa * i, P.b2);
    arm(SHOULDER.x + ca * i + px, SHOULDER.y + sa * i + py, P.b0);
  }
  arm(SHOULDER.x + ca * 5, SHOULDER.y + sa * 5, P.skin);
  for (let i = 6; i <= 8; i++) arm(SHOULDER.x + ca * i, SHOULDER.y + sa * i, P.s1);
  arm(SHOULDER.x + ca * 6 + px, SHOULDER.y + sa * 6 + py, P.s1);
  arm(SHOULDER.x + ca * 6 + px * 2, SHOULDER.y + sa * 6 + py * 2, P.s1);
  if (pose.loaded) {
    arm(SHOULDER.x + ca * 9, SHOULDER.y + sa * 9, P.wood);
    for (let j = -1; j <= 1; j++) arm(SHOULDER.x + ca * 10 + px * j, SHOULDER.y + sa * 10 + py * j, P.r1);
  }
  if (pose.stuck) {
    // gritted teeth and a furrowed brow
    grid[3][12] = P.o0;
    grid[4][12] = P.ink;
    grid[6][12] = P.white;
    grid[6][13] = P.ink;
  }

  const c = scratch ?? (scratch = makeCanvas(SPRITE_W + 2, SPRITE_H + 2));
  const cx = c.getContext('2d')!;
  cx.clearRect(0, 0, c.width, c.height);
  for (let y = -1; y <= SPRITE_H; y++)
    for (let x = -1; x <= SPRITE_W; x++) {
      const inside = y >= 0 && x >= 0 && y < SPRITE_H && x < SPRITE_W && mask[y][x];
      if (inside) {
        const col = grid[y][x];
        if (col) dot(cx, x + 1, y + 1, col);
        continue;
      }
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const X = x + dx;
        const Y = y + dy;
        return Y >= 0 && X >= 0 && Y < SPRITE_H && X < SPRITE_W && mask[Y][X];
      });
      if (touches) dot(cx, x + 1, y + 1, P.ink);
    }
  return c;
}

/**
 * Draw the dude with his hitbox top-left at (x, y) in game pixels. `tilt` (radians, for
 * the victory wheelie) rotates him back around the bottom of the big wheel.
 */
export function drawDude(ctx: Ctx, x: number, y: number, pose: DudePose, tilt = 0): void {
  const spr = buildDude(pose);
  x = Math.round(x);
  y = Math.round(y);
  ctx.save();
  if (tilt) {
    const pivotX = x + (pose.facing > 0 ? WHEEL.x : SPRITE_W - 1 - WHEEL.x);
    const pivotY = y + SPRITE_H;
    ctx.translate(pivotX, pivotY);
    ctx.rotate(-tilt * pose.facing);
    ctx.translate(-pivotX, -pivotY);
  }
  if (pose.facing < 0) {
    ctx.translate(x + SPRITE_W + 1, y - 1);
    ctx.scale(-1, 1);
    ctx.drawImage(spr, 0, 0);
  } else {
    ctx.drawImage(spr, x - 1, y - 1);
  }
  ctx.restore();
  if (pose.stuck) {
    // sweat drops flying off
    for (let i = 0; i < 2; i++) {
      const cyc = (pose.t * 2.2 + i * 0.5) % 1;
      const hx = x + 11 + (pose.facing > 0 ? -1 : 1) * (5 + cyc * 5);
      const hy = y - cyc * 3 + cyc * cyc * 9;
      if (cyc < 0.8) {
        dot(ctx, hx, hy, P.sweat);
        dot(ctx, hx, hy + 1, P.sweat);
      }
    }
  }
}

/** Where the rope leaves the gun, in game pixels, for a dude whose hitbox top-left is (x, y). */
export function muzzleOf(x: number, y: number, facing: 1 | -1, aim: number | null): { x: number; y: number } {
  const a = localAim(facing, aim);
  const lx = SHOULDER.x + Math.cos(a) * MUZZLE_REACH;
  const ly = SHOULDER.y + Math.sin(a) * MUZZLE_REACH;
  return { x: x + (facing > 0 ? lx : SPRITE_W - 1 - lx), y: y + ly };
}
