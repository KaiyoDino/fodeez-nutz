// Integer-pixel drawing helpers for the low-resolution game canvas. Everything here
// snaps to whole pixels so the art stays crisp.

export type Ctx = CanvasRenderingContext2D;

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function dot(ctx: Ctx, x: number, y: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** Bresenham line. `color` may vary along the line (i = pixel index). */
export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string | ((i: number) => string | null)): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let i = 0;
  for (let guard = 0; guard < 4000; guard++) {
    const c = typeof color === 'function' ? color(i++) : color;
    if (c) dot(ctx, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Filled pixel ellipse centered on (cx, cy). */
export function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: string): void {
  ctx.fillStyle = c;
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
    const span = rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry)));
    if (span < 0.5 && Math.abs(y) > ry - 0.5) continue;
    const x0 = Math.round(cx - span);
    const x1 = Math.round(cx + span);
    ctx.fillRect(x0, Math.round(cy + y), Math.max(1, x1 - x0), 1);
  }
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): Ctx {
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Add a 1px outline around every opaque pixel of a canvas (in place). */
export function outline(c: HTMLCanvasElement, color: string): void {
  const ctx = ctx2d(c);
  const { width: w, height: h } = c;
  const img = ctx.getImageData(0, 0, w, h);
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img.data[(y * w + x) * 4 + 3]);
  ctx.fillStyle = color;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (a(x, y) > 0) continue;
      if (a(x + 1, y) > 0 || a(x - 1, y) > 0 || a(x, y + 1) > 0 || a(x, y - 1) > 0) ctx.fillRect(x, y, 1, 1);
    }
}
