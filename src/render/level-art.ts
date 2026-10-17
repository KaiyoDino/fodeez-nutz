// Level art. Everything is drawn in game pixels (1 px = 2 world units).
// Static things are painted once into a world-sized canvas; animated things are drawn per frame.

import { CAMEOS, LEVEL, WORLD, type PlatformDef } from '../sim/level';
import { drawText, textWidth } from './font';
import { BAYER4, P } from './palette';
import { ctx2d, dot, line, makeCanvas, rect, type Ctx } from './px';

export const SCALE = 2;
export const WORLD_PX = { w: WORLD.w / SCALE, h: WORLD.h / SCALE };

interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
const toPx = (p: { x: number; y: number; w: number; h: number }): PxBox => ({ x: Math.round(p.x / SCALE), y: Math.round(p.y / SCALE), w: Math.round(p.w / SCALE), h: Math.round(p.h / SCALE) });

// ---------------------------------------------------------------- girders

export function drawGirder(ctx: Ctx, b: PxBox, heavy = false): void {
  const { x, y, w, h } = b;
  const vertical = h > w;
  const L = vertical ? h : w;
  const T = vertical ? w : h;
  const f = Math.max(3, Math.round(T * 0.2));
  // beam-space (u along, v across) to canvas
  const put = (u: number, v: number, len: number, thick: number, c: string) => (vertical ? rect(ctx, x + v, y + u, thick, len, c) : rect(ctx, x + u, y + v, len, thick, c));
  put(0, 0, L, T, P.g2);
  put(0, f + 1, L, 1, P.g1);
  put(0, T - f - 2, L, 1, P.g1);
  put(0, 0, L, f, P.g3);
  put(0, T - f, L, f, P.g3);
  put(0, 0, L, 1, P.g4);
  put(0, f - 1, L, 1, P.g1);
  put(0, T - 1, L, 1, P.g1);
  if (heavy) {
    // cross bracing in the web of the big outer beams
    const web0 = f + 2;
    const web1 = T - f - 3;
    for (let s = 0; s < L; s += 30) {
      for (let k = 0; k <= 30; k++) {
        const u = s + k;
        if (u >= L) break;
        const v1 = web0 + Math.round(((web1 - web0) * k) / 30);
        const v2 = web1 - Math.round(((web1 - web0) * k) / 30);
        put(u, v1, 1, 1, P.g1);
        put(u, v2, 1, 1, P.g1);
      }
    }
  }
  for (let s = 30; s < L; s += 60) put(s, 0, 1, T, P.g1);
  for (let u = 4; u < L - 2; u += 9)
    for (const v of [Math.floor(f / 2), T - f + Math.floor(f / 2) - 1]) {
      put(u, v, 1, 1, P.g5);
      put(u + 1, v + 1, 1, 1, P.g1);
    }
  ctx.strokeStyle = P.g0;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function girderCanvas(def: PlatformDef): HTMLCanvasElement {
  const b = toPx(def);
  const c = makeCanvas(b.w, b.h);
  drawGirder(ctx2d(c), { x: 0, y: 0, w: b.w, h: b.h });
  return c;
}

// ---------------------------------------------------------------- goop

/** The goop's body: dithered shading, gloss streak and outline. Animated bits are drawn separately. */
export function drawGoopBody(ctx: Ctx, b: PxBox): void {
  const { x, y, w, h } = b;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if ((i === 0 || i === w - 1) && (j === 0 || j === h - 1)) continue;
      const u = (i / w) * 0.35 + (j / h) * 0.65;
      let c: string = P.p2;
      if (u < 0.12) c = (i + j) % 2 ? P.p3 : P.p2;
      else if (u > 0.78) c = P.p1;
      else if (u > 0.62) c = (i + j) % 2 ? P.p1 : P.p2;
      dot(ctx, x + i, y + j, c);
    }
  for (let yy = y + 3; yy < y + h - 4; yy++)
    if ((yy - y) % 13 < 9) {
      dot(ctx, x + 2, yy, P.p3);
      if ((yy - y) % 13 < 3) dot(ctx, x + 3, yy, P.p4);
    }
  rect(ctx, x + 1, y - 1, w - 2, 1, P.p0);
  rect(ctx, x + 1, y + h, w - 2, 1, P.p0);
  rect(ctx, x - 1, y + 1, 1, h - 2, P.p0);
  rect(ctx, x + w, y + 1, 1, h - 2, P.p0);
  dot(ctx, x, y, P.p0);
  dot(ctx, x + w - 1, y, P.p0);
  dot(ctx, x, y + h - 1, P.p0);
  dot(ctx, x + w - 1, y + h - 1, P.p0);
}

/** Wobbling lip, rising bubbles and drips. */
export function drawGoopLife(ctx: Ctx, b: PxBox, t: number, seed: number): void {
  const { x, y, w, h } = b;
  for (let i = 2; i < w - 2; i++) {
    const s = Math.sin(i * 0.55 + t * 3 + seed);
    if (s > 0.35) {
      dot(ctx, x + i, y - 1, P.p3);
      dot(ctx, x + i, y - 2, P.p0);
    }
    if (s > 0.85) {
      dot(ctx, x + i, y - 2, P.p3);
      dot(ctx, x + i, y - 3, P.p0);
    }
  }
  const n = Math.max(2, Math.round((w * h) / 160));
  for (let i = 0; i < n; i++) {
    const cyc = (t * 0.25 + i * 0.37 + seed * 0.1) % 1;
    const bx = x + 4 + ((i * 17 + seed * 5) % Math.max(1, w - 7));
    const by = y + h - 3 - cyc * (h - 5);
    dot(ctx, bx, by, cyc > 0.85 ? P.p3 : P.p4);
    if (i % 3 === 0 && cyc < 0.85) dot(ctx, bx + 1, by, P.p3);
  }
  for (let i = 0; i < Math.max(1, Math.floor(w / 11)); i++) {
    const dx = x + 4 + i * 11 + (i % 2) * 3;
    if (dx > x + w - 3) break;
    const cyc = (t * 0.6 + i * 0.43 + seed * 0.21) % 1;
    const len = 1 + Math.floor(cyc * 6);
    rect(ctx, dx, y + h, 2, len, P.p2);
    dot(ctx, dx + 1, y + h + len - 1, P.p1);
    if (cyc > 0.75) dot(ctx, dx, y + h + len + Math.floor((cyc - 0.75) * 40), P.p2);
  }
}

export function goopCanvas(def: PlatformDef): HTMLCanvasElement {
  const b = toPx(def);
  const c = makeCanvas(b.w + 2, b.h + 2);
  drawGoopBody(ctx2d(c), { x: 1, y: 1, w: b.w, h: b.h });
  return c;
}

// ---------------------------------------------------------------- springs

/** comp: 0..1 compression of the hit face. */
export function drawSpring(ctx: Ctx, b: PxBox, comp: number, side: 'top' | 'bottom' | 'left' | 'right'): void {
  const vertical = b.h > b.w;
  if (!vertical) return drawSpringPad(ctx, b, side === 'bottom' ? 0 : comp);
  // a tall spring wall: plates on both faces, coils running across
  const { x, y, w, h } = b;
  const plate = 3;
  const pushL = side === 'left' ? Math.round(comp * 4) : 0;
  const pushR = side === 'right' ? Math.round(comp * 4) : 0;
  rect(ctx, x + Math.floor(w / 2) - 1, y, 2, h, P.s1);
  const left = x + pushL + plate;
  const right = x + w - pushR - plate - 1;
  for (let yy = y + 2; yy < y + h - 2; yy += 7) {
    line(ctx, left, yy, right, yy + 3, P.s1);
    line(ctx, left, yy + 1, right, yy + 4, P.s1);
    line(ctx, right, yy + 3, left, yy + 7, P.s4);
    line(ctx, right, yy + 4, left, yy + 8, P.s3);
  }
  for (const [px, push] of [[x + pushL, 0], [x + w - plate - pushR, 1]] as const) {
    rect(ctx, px - 1, y - 1, plate + 2, h + 2, P.ink);
    rect(ctx, px, y, plate, h, P.r1);
    rect(ctx, push ? px + plate - 1 : px, y, 1, h, push ? P.r0 : P.r2);
    for (let yy = y + 3; yy < y + h - 2; yy += 6) dot(ctx, px + 1, yy, P.r0);
  }
  // hazard caps top and bottom
  for (const cy of [y, y + h - 3]) {
    rect(ctx, x, cy, w, 3, P.black);
    for (let i = 0; i < w; i++) if (((i + cy) >> 1) % 2 === 0) dot(ctx, x + i, cy + 1, P.y1);
  }
}

function drawSpringPad(ctx: Ctx, b: PxBox, comp: number): void {
  const { x, y, w, h } = b;
  const plateH = 4;
  const baseH = 4;
  const top = y + Math.round(comp * h * 0.35);
  rect(ctx, x - 1, y + h - baseH - 1, w + 2, baseH + 1, P.ink);
  rect(ctx, x, y + h - baseH, w, baseH, P.black);
  for (let j = 0; j < baseH - 1; j++) for (let i = 0; i < w; i++) if (((i + j) >> 1) % 2 === 0) dot(ctx, x + i, y + h - baseH + 1 + j, P.y1);
  rect(ctx, x, y + h - baseH, w, 1, P.s2);
  const coilTop = top + plateH;
  const coilBot = y + h - baseH - 1;
  const n = Math.max(2, Math.round(w / 17));
  for (let k = 0; k < n; k++) {
    const cx = x + Math.round((w * (k + 0.5)) / n);
    const rw = Math.min(6, Math.floor(w / n / 2) - 1);
    const turns = 3;
    const span = coilBot - coilTop;
    for (let i = 0; i < turns; i++) {
      const y0 = coilTop + (span * i) / turns;
      const y1 = coilTop + (span * (i + 0.5)) / turns;
      const y2 = coilTop + (span * (i + 1)) / turns;
      line(ctx, cx - rw, y0, cx + rw, y1, P.s1);
      line(ctx, cx - rw, y0 + 1, cx + rw, y1 + 1, P.s1);
      line(ctx, cx + rw, y1, cx - rw, y2, P.s4);
      line(ctx, cx + rw, y1 + 1, cx - rw, y2 + 1, P.s3);
    }
  }
  rect(ctx, x - 2, top - 1, w + 4, plateH + 2, P.ink);
  rect(ctx, x - 1, top, w + 2, plateH, P.r1);
  rect(ctx, x - 1, top, w + 2, 1, P.r2);
  rect(ctx, x - 1, top + plateH - 1, w + 2, 1, P.r0);
  for (let i = 3; i < w - 2; i += 6) dot(ctx, x + i, top + 1, P.r0);
}

// ---------------------------------------------------------------- targets

const targetCache = new Map<string, HTMLCanvasElement>();
/** The concentric target from the original (white, black, cyan, red, yellow). 13x13 px plus a 1 px glow. */
export function targetSprite(state: 'normal' | 'bright' | 'dim'): HTMLCanvasElement {
  let c = targetCache.get(state);
  if (c) return c;
  c = makeCanvas(15, 15);
  const ctx = ctx2d(c);
  const n = 13;
  const cols: string[] = state === 'dim' ? [P.s3, P.s0, P.s2, P.s2, P.s1, P.s2, P.s2, P.s2] : [P.white, P.black, P.c1, P.c1, P.r1, P.y1, P.y1, P.y1];
  if (state === 'bright') {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = P.c1;
    ctx.strokeRect(0.5, 0.5, 14, 14);
    ctx.globalAlpha = 1;
  }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const ring = Math.min(i, j, n - 1 - i, n - 1 - j);
      let col = cols[Math.min(ring, cols.length - 1)];
      if (state === 'bright' && ring >= 6) col = P.y2;
      dot(ctx, 1 + i, 1 + j, col);
    }
  targetCache.set(state, c);
  return c;
}

// ---------------------------------------------------------------- goal room

export function drawGoalRoom(ctx: Ctx, b: PxBox): void {
  const cell = 10;
  for (let i = 0; i * cell < b.w; i++)
    for (let j = 0; j * cell < b.h; j++) rect(ctx, b.x + i * cell, b.y + j * cell, Math.min(cell, b.w - i * cell), Math.min(cell, b.h - j * cell), (i + j) % 2 ? P.black : P.white);
  // banner
  const label = 'FINISH';
  const s = 3;
  const tw = textWidth(label, s);
  const bx = b.x + Math.round((b.w - tw) / 2) - 8;
  const by = b.y + Math.round(b.h / 2) - 14;
  rect(ctx, bx - 1, by - 1, tw + 18, 7 * s + 14, P.ink);
  rect(ctx, bx, by, tw + 16, 7 * s + 12, P.r1);
  rect(ctx, bx, by, tw + 16, 2, P.r2);
  rect(ctx, bx, by + 7 * s + 10, tw + 16, 2, P.r0);
  drawText(ctx, label, bx + 9, by + 7, P.r0, s);
  drawText(ctx, label, bx + 8, by + 6, P.white, s);
}

// ---------------------------------------------------------------- decorations

/** A sign. With `ground` set, (x, y) is ignored for y and it stands on posts reaching down to that ground line. */
function sign(ctx: Ctx, x: number, y: number, lines: string[], bg: string, fg: string, opts: { posts?: number; ground?: number; scale?: number; stripes?: boolean } = {}): void {
  const s = opts.scale ?? 1;
  const w = Math.max(...lines.map(l => textWidth(l, s))) + 8;
  const h = lines.length * 9 * s + 5;
  if (opts.ground !== undefined) y = opts.ground - (opts.posts ?? 0) - h;
  if (opts.posts) {
    rect(ctx, x + 4, y + h, 2, opts.posts, P.s1);
    rect(ctx, x + w - 6, y + h, 2, opts.posts, P.s1);
  }
  rect(ctx, x - 1, y - 1, w + 2, h + 2, P.ink);
  rect(ctx, x, y, w, h, bg);
  if (opts.stripes) for (let i = 0; i < w; i++) if (((i >> 1) & 1) === 0) {
    dot(ctx, x + i, y, P.black);
    dot(ctx, x + i, y + h - 1, P.black);
  }
  lines.forEach((l, k) => drawText(ctx, l, x + Math.round((w - textWidth(l, s)) / 2), y + 3 + k * 9 * s, fg, s));
}

function lamp(ctx: Ctx, x: number, y: number, cable: number): void {
  rect(ctx, x, y, 1, cable, P.s0);
  const ly = y + cable;
  rect(ctx, x - 3, ly, 7, 3, P.s1);
  rect(ctx, x - 2, ly + 3, 5, 1, P.y2);
  // soft cone of light, dithered
  for (let j = 0; j < 40; j++) {
    const half = 2 + j * 0.55;
    for (let i = -Math.floor(half); i <= Math.floor(half); i++) {
      const fade = j / 40 + Math.abs(i) / (half * 3);
      if (fade * 16 < BAYER4[(ly + j) & 3][(x + i) & 3] * 0.55) dot(ctx, x + i, ly + 4 + j, 'rgba(255,214,140,0.16)');
    }
  }
}

/** The skeleton of the building behind everything: dim columns and beams. */
function backFrame(ctx: Ctx): void {
  ctx.globalAlpha = 0.55;
  const col = '#241c40';
  const col2 = '#3a2f63';
  for (const cx of [250, 500, 750]) {
    rect(ctx, cx - 4, 50, 8, WORLD_PX.h - 100, col);
    rect(ctx, cx - 4, 50, 1, WORLD_PX.h - 100, col2);
  }
  for (let by = 250; by < WORLD_PX.h - 60; by += 220) {
    rect(ctx, 50, by, WORLD_PX.w - 100, 5, col);
    rect(ctx, 50, by, WORLD_PX.w - 100, 1, col2);
  }
  ctx.globalAlpha = 1;
}

export interface StaticLayer {
  canvas: HTMLCanvasElement;
}

/** Paint everything that never moves (in both modes) into one world-sized canvas. */
export function buildStaticLayer(): StaticLayer {
  const c = makeCanvas(WORLD_PX.w, WORLD_PX.h);
  const ctx = ctx2d(c);
  backFrame(ctx);

  // decorations (world px coordinates)
  const floor = WORLD_PX.h - 50;
  sign(ctx, 70, 0, ['FODEEZ NUTZ', 'CONSTRUCTION CO.'], P.y1, P.ink, { posts: 40, ground: floor, stripes: true });
  sign(ctx, 600, 0, ['NO', 'CHECKPOINTS'], P.white, P.r0, { posts: 22, ground: floor });
  sign(ctx, 866, 0, ['EXIT ;('], P.green, P.ink, { ground: floor - 50 });
  // a door under the exit sign that goes nowhere
  rect(ctx, 874, 1852, 22, 48, P.ink);
  rect(ctx, 875, 1853, 20, 47, P.s1);
  rect(ctx, 891, 1876, 2, 2, P.y1);
  sign(ctx, 680, 1110, ['CAUTION', 'GOOP'], P.y1, P.ink, { stripes: true });
  sign(ctx, 880, 66, ['ALMOST', 'THERE'], P.white, P.ink, {});
  lamp(ctx, 425, 1550, 3);
  lamp(ctx, 200, 550, 2);
  lamp(ctx, 350, 550, 2);
  lamp(ctx, 600, 50, 30);
  lamp(ctx, 850, 50, 18);
  // stencilled area numbers on the outer walls
  const stencil = (x: number, y: number, n: string) => drawText(ctx, n, x, y, P.g1, 4);
  stencil(15, 1680, '1');
  stencil(15, 1150, '2');
  stencil(965, 420, '3');
  stencil(15, 280, '4');

  for (let i = 0; i < LEVEL.length; i++) {
    const def = LEVEL[i];
    // movers, map tricks and mode-only pieces are drawn every frame instead
    if (def.mover || def.role || def.onlyIn) continue;
    const b = toPx(def);
    if (def.kind === 'girder') drawGirder(ctx, b, def.w >= 100 && def.h >= 100);
    else if (def.kind === 'goop') drawGoopBody(ctx, b);
    else if (def.kind === 'goal') drawGoalRoom(ctx, b);
  }
  // outer walls on top so corners are clean
  for (let i = 0; i < 4; i++) drawGirder(ctx, toPx(LEVEL[i]), true);
  return { canvas: c };
}

export { toPx, CAMEOS };
