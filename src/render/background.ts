// The sky behind the tower: sunset at the bottom, night at the top, with a city
// skyline, cranes and clouds on parallax layers.

import { WORLD_PX } from './level-art';
import { BAYER4, P, rgb } from './palette';
import { ctx2d, dot, ellipse, line, makeCanvas, rect, type Ctx } from './px';

// The camera's y range (-150 at the top to about 1490 at the bottom) maps onto sky rows
// 0..~660, so the bottom of the tower sits in the sunset and the top in the night.
const SKY_FACTOR = 0.41;
const SKY_TOP = -150;
const TEX_W = 64;
const TEX_H = 2400;

const STOPS: [number, string][] = [
  [0, '#0d0b20'],
  [300, '#141130'],
  [520, '#1b1838'],
  [640, '#2a2152'],
  [760, '#43306c'],
  [880, '#6b3a78'],
  [980, '#a24f7c'],
  [1060, '#d9677a'],
  [1130, '#f28a68'],
  [1250, '#f7a96f'],
  [TEX_H, '#f7a96f'],
];

let skyTex: HTMLCanvasElement | null = null;
function skyTexture(): HTMLCanvasElement {
  if (skyTex) return skyTex;
  const c = makeCanvas(TEX_W, TEX_H);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(TEX_W, TEX_H);
  for (let y = 0; y < TEX_H; y++) {
    let k = 0;
    while (k < STOPS.length - 2 && STOPS[k + 1][0] <= y) k++;
    const [y0, c0] = STOPS[k];
    const [y1, c1] = STOPS[k + 1];
    const f = (y - y0) / Math.max(1, y1 - y0);
    for (let x = 0; x < TEX_W; x++) {
      const col = rgb(f * 16 > BAYER4[y & 3][x & 3] ? c1 : c0);
      const o = (y * TEX_W + x) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  skyTex = c;
  return c;
}

// deterministic pseudo-random for decoration placement
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const STARS = Array.from({ length: 260 }, (_, i) => ({ x: hash(i) * 2400, y: Math.pow(hash(i + 999), 1.6) * 820, big: hash(i + 77) > 0.93, tw: hash(i + 5) * 6.28 }));

let cityFar: HTMLCanvasElement | null = null;
let cityNear: HTMLCanvasElement | null = null;
function city(far: boolean): HTMLCanvasElement {
  const cached = far ? cityFar : cityNear;
  if (cached) return cached;
  const w = 1200;
  const h = far ? 150 : 110;
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  let x = 0;
  let i = far ? 500 : 0;
  while (x < w) {
    const bw = 14 + Math.floor(hash(i) * 36);
    const bh = Math.floor((far ? 40 : 25) + hash(i + 1) * (far ? 105 : 80));
    const col = far ? P.cityFar : P.city;
    rect(ctx, x, h - bh, bw, bh, col);
    if (hash(i + 2) > 0.7) rect(ctx, x + Math.floor(bw / 2) - 1, h - bh - 6, 2, 6, col); // antenna
    if (!far)
      for (let wy = h - bh + 4; wy < h - 3; wy += 6)
        for (let wx = x + 2; wx < x + bw - 2; wx += 4) if (hash(wx * 7 + wy * 13) > 0.72) rect(ctx, wx, wy, 2, 2, P.cityWin);
    x += bw + (far ? 1 : 3);
    i += 3;
  }
  if (far) cityFar = c;
  else cityNear = c;
  return c;
}

let craneArt: HTMLCanvasElement | null = null;
function crane(): HTMLCanvasElement {
  if (craneArt) return craneArt;
  const w = 260;
  const h = 520;
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  const mast = 60;
  const jibY = 30;
  const col = P.crane;
  rect(ctx, mast - 3, jibY, 7, h - jibY, col);
  for (let y = h; y > jibY; y -= 10) {
    line(ctx, mast - 3, y, mast + 3, y - 10, col);
    line(ctx, mast + 3, y, mast - 3, y - 10, col);
  }
  rect(ctx, 0, jibY, w, 3, col);
  rect(ctx, 0, jibY + 8, w - 30, 2, col);
  for (let x = 0; x < w - 30; x += 10) {
    line(ctx, x, jibY + 9, x + 5, jibY + 3, col);
    line(ctx, x + 5, jibY + 3, x + 10, jibY + 9, col);
  }
  line(ctx, mast, 0, w - 10, jibY, col);
  line(ctx, mast, 0, 2, jibY, col);
  rect(ctx, mast - 2, 0, 5, jibY, col);
  rect(ctx, 4, jibY + 3, 22, 14, col); // counterweight
  rect(ctx, mast + 6, jibY + 4, 14, 12, col); // cab
  rect(ctx, mast + 8, jibY + 6, 4, 4, '#3b3168');
  craneArt = c;
  return c;
}

export interface View {
  /** camera top-left, game px */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Camera y at the very bottom of the world; parallax layers are anchored there. */
const bottomCam = (v: View) => WORLD_PX.h + 100 - v.h;

export function drawSky(ctx: Ctx, v: View, t: number): void {
  const tex = skyTexture();
  const srcY = Math.max(0, Math.min(TEX_H - v.h, Math.round((v.y - SKY_TOP) * SKY_FACTOR)));
  for (let x = 0; x < v.w; x += TEX_W) ctx.drawImage(tex, 0, srcY, TEX_W, v.h, x, 0, TEX_W, v.h);

  // stars live in sky-texture space
  const shiftX = -v.x * 0.05;
  for (const s of STARS) {
    const sy = s.y - srcY;
    if (sy < 0 || sy >= v.h) continue;
    const sx = ((((s.x + shiftX) % 2400) + 2400) % 2400) - 200;
    if (sx < 0 || sx >= v.w) continue;
    const fade = s.y > 640 ? 0 : 1;
    if (!fade) continue;
    const tw = Math.sin(t * 1.7 + s.tw);
    dot(ctx, sx, sy, tw > -0.3 ? P.star : P.starDim);
    if (s.big && tw > 0.6) {
      dot(ctx, sx - 1, sy, P.starDim);
      dot(ctx, sx + 1, sy, P.starDim);
      dot(ctx, sx, sy - 1, P.starDim);
      dot(ctx, sx, sy + 1, P.starDim);
    }
  }
  // the occasional shooting star near the top
  const cycle = t % 9;
  if (cycle < 0.7 && srcY < 300) {
    const k = cycle / 0.7;
    const sx = v.w * (0.2 + 0.5 * ((Math.floor(t / 9) * 0.37) % 1)) + k * 120;
    const sy = 60 - srcY + k * 50;
    for (let i = 0; i < 10; i++) dot(ctx, sx - i * 2.4, sy - i, i < 2 ? P.star : P.starDim);
  }

  // moon
  const my = 210 - srcY;
  if (my > -30 && my < v.h + 30) {
    const mx = Math.round(v.w * 0.78);
    ellipse(ctx, mx, my, 14, 14, P.moon);
    ellipse(ctx, mx + 5, my - 3, 3, 3, P.moonShade);
    ellipse(ctx, mx - 4, my + 5, 2, 2, P.moonShade);
    ellipse(ctx, mx + 2, my + 7, 1.5, 1.5, P.moonShade);
  }

  // sun sinking behind the city
  const sunY = 1185 - srcY;
  if (sunY > -40 && sunY < v.h + 40) {
    const sx = Math.round(v.w * 0.7);
    for (let y = -26; y <= 26; y++)
      for (let x = -26; x <= 26; x++) {
        const d = Math.hypot(x, y);
        if (d < 14) dot(ctx, sx + x, sunY + y, P.sun0);
        else if (d < 21 && (d - 14) * 2.3 < BAYER4[(sunY + y) & 3][(sx + x) & 3]) dot(ctx, sx + x, sunY + y, P.sun1);
      }
  }
}

/** Parallax layers in front of the sky but behind the tower. */
export function drawBackdrop(ctx: Ctx, v: View, t: number): void {
  const bc = bottomCam(v);
  const rise = bc - v.y; // how far above the bottom the camera is, game px

  // clouds at a few altitudes
  for (let i = 0; i < 18; i++) {
    const alt = 120 + i * 105; // game px above the bottom
    const sy = Math.round(v.h - 60 - alt * 0.45 + rise * 0.45);
    if (sy < -20 || sy > v.h + 20) continue;
    const speed = 3 + hash(i) * 5;
    const span = v.w + 160;
    const sx = Math.round(((((hash(i + 40) * span + t * speed) % span) + span) % span) - 80 - v.x * 0.2);
    const night = alt > 1200;
    ctx.globalAlpha = night ? 0.5 : 0.28;
    const col = night ? P.cloudNight : P.cloud;
    const len = 24 + Math.floor(hash(i + 9) * 30);
    rect(ctx, sx, sy, len, 3, col);
    rect(ctx, sx + 5, sy - 2, len - 12, 2, col);
    rect(ctx, sx + 10, sy - 4, Math.max(4, len - 26), 2, col);
    ctx.globalAlpha = 1;
  }

  // cranes, slowly sinking as you climb
  const cr = crane();
  const craneBase = v.h + 40 + rise * 0.6;
  const hx = (x: number, f: number) => Math.round(x - v.x * f);
  for (const [x, flip] of [[v.w * 0.08, false], [v.w * 0.82, true]] as const) {
    const top = Math.round(craneBase - cr.height);
    if (top > v.h) continue;
    ctx.save();
    if (flip) {
      ctx.translate(hx(x, 0.3) + cr.width, top);
      ctx.scale(-1, 1);
      ctx.drawImage(cr, 0, 0);
    } else ctx.drawImage(cr, hx(x, 0.3), top);
    ctx.restore();
    // swinging hook
    const hookX = flip ? hx(x, 0.3) + cr.width - 200 : hx(x, 0.3) + 200;
    const sw = Math.round(Math.sin(t * 0.8 + (flip ? 1 : 0)) * 2);
    rect(ctx, hookX, top + 33, 1, 46 + sw, P.crane);
    rect(ctx, hookX - 2, top + 79 + sw, 5, 3, P.crane);
  }

  // skylines
  const far = city(true);
  const near = city(false);
  const farY = Math.round(v.h - far.height + 30 + rise * 0.35);
  if (farY < v.h) for (let x = -((Math.round(v.x * 0.15) % far.width) + far.width) % far.width - far.width; x < v.w; x += far.width) ctx.drawImage(far, x, farY);
  const nearY = Math.round(v.h - near.height + 50 + rise * 0.55);
  if (nearY < v.h) for (let x = -((Math.round(v.x * 0.3) % near.width) + near.width) % near.width - near.width; x < v.w; x += near.width) ctx.drawImage(near, x, nearY);
}

/** Concrete footing and dirt under the tower, for when the camera looks below the floor. */
export function drawGround(ctx: Ctx, v: View): void {
  const gy = WORLD_PX.h - v.y;
  if (gy >= v.h) return;
  rect(ctx, 0, gy, v.w, v.h - gy, P.dirt0);
  rect(ctx, 0, gy, v.w, 8, P.concrete0);
  rect(ctx, 0, gy, v.w, 1, P.concrete2);
  for (let x = -((v.x % 40) + 40) % 40; x < v.w; x += 40) rect(ctx, x, gy + 1, 1, 7, P.dirt1);
  for (let y = gy + 9; y < v.h; y += 3)
    for (let x = 0; x < v.w; x += 5) if (hash((x + v.x) * 0.37 + y * 1.91) > 0.82) dot(ctx, x + ((y >> 1) & 3), y, P.dirt1);
}
