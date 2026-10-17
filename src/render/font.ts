// A 5x7 bitmap font for the HUD, signs and the logo, so text sits on the same pixel grid as the art.

import { makeCanvas, type Ctx } from './px';

const G: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '..#..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '/': ['.....', '....#', '...#.', '..#..', '.#...', '#....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
  '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '#': ['.#.#.', '#####', '.#.#.', '.#.#.', '.#.#.', '#####', '.#.#.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

/** Pixel rows for a glyph (7 rows of 5) joined into one string. Unknown characters render as blank. */
const joined = new Map<string, string>();
function rows(ch: string): string {
  const k = ch.toUpperCase();
  let g = joined.get(k);
  if (!g) {
    g = (G[k] ?? G[' ']).join('');
    joined.set(k, g);
  }
  return g;
}

export const GLYPH_W = 5;
export const GLYPH_H = 7;
export const ADVANCE = 6;

export function textWidth(text: string, scale = 1): number {
  return text.length === 0 ? 0 : (text.length * ADVANCE - 1) * scale;
}

/** Draw text with its top-left at (x, y). Each font pixel is `scale` canvas pixels. */
export function drawText(ctx: Ctx, text: string, x: number, y: number, color: string, scale = 1): void {
  ctx.fillStyle = color;
  x = Math.round(x);
  y = Math.round(y);
  for (let i = 0; i < text.length; i++) {
    const g = rows(text[i]);
    for (let r = 0; r < GLYPH_H; r++)
      for (let c = 0; c < GLYPH_W; c++) if (g[r * 5 + c] === '#') ctx.fillRect(x + (i * ADVANCE + c) * scale, y + r * scale, scale, scale);
  }
}

const outlinedCache = new Map<string, HTMLCanvasElement>();

/** Text with a 1-pixel dark outline, for HUD text over busy backgrounds. Rendered once per string and cached. */
export function drawTextOutlined(ctx: Ctx, text: string, x: number, y: number, color: string, outlineColor: string, scale = 1): void {
  const key = `${text}|${color}|${outlineColor}|${scale}`;
  let c = outlinedCache.get(key);
  if (!c) {
    if (outlinedCache.size > 300) outlinedCache.clear();
    c = makeCanvas(textWidth(text, scale) + scale * 2, GLYPH_H * scale + scale * 2);
    const cc = c.getContext('2d')!;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) drawText(cc, text, scale + dx * scale, scale + dy * scale, outlineColor, scale);
    drawText(cc, text, scale, scale, color, scale);
    outlinedCache.set(key, c);
  }
  ctx.drawImage(c, Math.round(x) - scale, Math.round(y) - scale);
}

/**
 * Big chunky title text: each font pixel becomes a block with a highlight on top, a dark
 * outline and a drop shadow. Returns a canvas so it can be cached.
 */
export function bigText(text: string, block: number, fill: string, light: string, dark: string, outlineColor: string, shadow: string): HTMLCanvasElement {
  const w = textWidth(text, block) + block * 2 + 2;
  const h = GLYPH_H * block + block * 2 + 3;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const ox = block;
  const oy = block;
  const on = (i: number, r: number, col: number) => r >= 0 && r < GLYPH_H && col >= 0 && col < GLYPH_W && rows(text[i])[r * 5 + col] === '#';
  const pass = (dx: number, dy: number, color: string, grow: number) => {
    ctx.fillStyle = color;
    for (let i = 0; i < text.length; i++)
      for (let r = 0; r < GLYPH_H; r++)
        for (let col = 0; col < GLYPH_W; col++)
          if (on(i, r, col)) ctx.fillRect(ox + (i * ADVANCE + col) * block + dx - grow, oy + r * block + dy - grow, block + grow * 2, block + grow * 2);
  };
  pass(2, 3, shadow, 1);
  pass(0, 0, outlineColor, 1);
  pass(0, 0, fill, 0);
  // light on top edges, dark on bottom edges of each glyph pixel run
  for (let i = 0; i < text.length; i++)
    for (let r = 0; r < GLYPH_H; r++)
      for (let col = 0; col < GLYPH_W; col++) {
        if (!on(i, r, col)) continue;
        const px = ox + (i * ADVANCE + col) * block;
        const py = oy + r * block;
        if (!on(i, r - 1, col)) {
          ctx.fillStyle = light;
          ctx.fillRect(px, py, block, Math.max(1, Math.floor(block / 3)));
        }
        if (!on(i, r + 1, col)) {
          ctx.fillStyle = dark;
          ctx.fillRect(px, py + block - Math.max(1, Math.floor(block / 4)), block, Math.max(1, Math.floor(block / 4)));
        }
      }
  return c;
}
