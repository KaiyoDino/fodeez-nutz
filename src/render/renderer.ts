// Draws a frame: sky, tower, dude, rope, particles, HUD. The game is drawn at low
// resolution (1 px = 2 world units), upscaled by a whole number with no smoothing, then
// smoothed down to the exact window size ("sharp bilinear") so pixels stay even.

import { DUDE, heightOf, TOWER, type MapDef, type MapId } from '../sim/level';
import { handOf, NA, nearHand } from '../sim/newage';
import { HOOK_RANGE, HOOK_SIZE } from '../sim/original';
import type { Sim } from '../sim/sim';
import type { SimEvent } from '../sim/types';
import { isVisible } from '../sim/world';
import { drawBackdrop, drawGround, drawSky, type View } from './background';
import { drawCameos } from './cameos';
import { drawDude, muzzleOf, SPRITE_H, SPRITE_W, type DudePose } from './dude';
import { drawText, drawTextOutlined, textWidth } from './font';
import { BEACONS, buildStaticLayer, drawGoopLife, drawSpring, girderCanvas, goopCanvas, SCALE, targetSprite, toPx, worldPx } from './level-art';
import { P } from './palette';
import { Particles } from './particles';
import type { WheelStyle } from './wheels';
import { ctx2d, dot, line, makeCanvas, rect, type Ctx } from './px';

/** Positions from the previous tick, for interpolation. */
export interface Snapshot {
  dx: number;
  dy: number;
  hx: number;
  hy: number;
  platX: number[];
}

export function snapshot(sim: Sim): Snapshot {
  const h = sim.hookView();
  return { dx: sim.state.dude.x, dy: sim.state.dude.y, hx: h.x, hy: h.y, platX: sim.state.world.platX.slice() };
}

export interface FrameInput {
  sim: Sim;
  prev: Snapshot;
  alpha: number;
  t: number;
  dt: number;
  /** Pointer in CSS px relative to the canvas, or null when it's not over the game. */
  pointer: { x: number; y: number } | null;
  aimGuide: boolean;
  showTimer: boolean;
  shake: boolean;
  hud: boolean;
  /** Show the crosshair and aim (false behind menus). */
  interactive: boolean;
  debug: boolean;
  /** Set while watching a replay. */
  replay?: { speed: number; paused: boolean } | null;
  /** Crosshair size. */
  cursor: 'small' | 'medium' | 'large';
  /** The dude's wheels. */
  wheels?: WheelStyle;
}

interface Message {
  text: string;
  sub?: string;
  t0: number;
  dur: number;
  color: string;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private low = makeCanvas(960, 540);
  private lctx = ctx2d(this.low);
  private mid = makeCanvas(960, 540);
  private mctx = ctx2d(this.mid);
  private vw = 960;
  private vh = 540;
  private scale = 1;
  private dpr = 1;
  private k = 1;
  /** Camera zoom: 1 shows at least 960x540 game px; bigger shows less, closer up. */
  private zoom = 1;
  private cssSize = { w: 960, h: 540, dpr: 1 };

  private platformArt = new Map<string, HTMLCanvasElement>();
  /** The map being drawn (taken from the simulation each frame). */
  private map: MapDef = TOWER;

  camX = 0;
  camY = TOWER.world.h / SCALE - 540;
  private snapCamera = true;
  private wheel = 0;
  private wheelSpin = 0;
  private lastDudeX = 0;
  private squash = 0;
  private shakeAmt = 0;
  private fade = 0;
  private fadeHold = 0;
  private won = 0;
  private retract: { x: number; y: number; t: number } | null = null;
  private springs = new Map<number, { t: number; side: 'top' | 'bottom' | 'left' | 'right' }>();
  private targetFlash = new Map<number, number>();
  private roleAlpha = new Map<number, number>();
  private cameoAlpha = 0;
  private messages: Message[] = [];
  /** Where presses landed during a replay (world units), drawn as fading rings. */
  private clicks: { x: number; y: number; t: number }[] = [];
  readonly particles = new Particles();
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  /** Pre-rendered art for platforms that are drawn every frame (movers, map tricks, mode-only goop). */
  private artFor(i: number): HTMLCanvasElement | undefined {
    const key = `${this.map.id}:${i}`;
    let art = this.platformArt.get(key);
    if (!art) {
      const def = this.map.platforms[i];
      if (def.kind === 'girder' && (def.mover || def.role)) art = girderCanvas(def);
      else if (def.kind === 'goop' && (def.mover || def.onlyIn)) art = goopCanvas(def);
      if (art) this.platformArt.set(key, art);
    }
    return art;
  }

  private staticLayers = new Map<MapId, HTMLCanvasElement>();
  private staticFor(): HTMLCanvasElement {
    let c = this.staticLayers.get(this.map.id);
    if (!c) {
      c = buildStaticLayer(this.map).canvas;
      this.staticLayers.set(this.map.id, c);
    }
    return c;
  }

  setZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.resize(this.cssSize.w, this.cssSize.h, this.cssSize.dpr);
  }

  /** Size the canvas to the window. At zoom 1 the view is at least 960x540 game px (1920x1080 world). */
  resize(cssW: number, cssH: number, devicePixelRatio: number): void {
    this.cssSize = { w: cssW, h: cssH, dpr: devicePixelRatio };
    this.dpr = Math.min(3, Math.max(1, devicePixelRatio || 1));
    const devW = Math.max(1, Math.round(cssW * this.dpr));
    const devH = Math.max(1, Math.round(cssH * this.dpr));
    this.canvas.width = devW;
    this.canvas.height = devH;
    const aspect = devW / devH;
    if (aspect >= 16 / 9) {
      this.vh = 540;
      this.vw = Math.round(540 * aspect);
    } else if (aspect >= 1) {
      this.vw = 960;
      this.vh = Math.round(960 / aspect);
    } else {
      // portrait phones: a narrower view so the art isn't microscopic
      this.vw = 600;
      this.vh = Math.round(600 / aspect);
    }
    this.vw = Math.round(this.vw / this.zoom);
    this.vh = Math.round(this.vh / this.zoom);
    // Small screens: shrink the view until a game pixel is about a CSS pixel, but always
    // keep at least 400 game px (800 world units) on the short side (less when zoomed in).
    const cssScale = cssH / this.vh;
    if (cssScale < 1) {
      const f = Math.max(cssScale, 400 / this.zoom / Math.min(this.vw, this.vh));
      if (f < 1) {
        this.vw = Math.round(this.vw * f);
        this.vh = Math.round(this.vh * f);
      }
    }
    this.scale = devH / this.vh;
    this.k = Math.max(1, Math.ceil(this.scale - 1e-6));
    this.low.width = this.vw;
    this.low.height = this.vh;
    this.mid.width = this.vw * this.k;
    this.mid.height = this.vh * this.k;
    this.lctx = ctx2d(this.low);
    this.mctx = ctx2d(this.mid);
    this.snapCamera = true;
  }

  /** CSS px on the canvas to world units. */
  screenToWorld(x: number, y: number): { x: number; y: number } {
    const gx = (x * this.dpr) / this.scale;
    const gy = (y * this.dpr) / this.scale;
    return { x: (Math.round(this.camX) + gx) * SCALE, y: (Math.round(this.camY) + gy) * SCALE };
  }

  /** Is this CSS point on the pause button in the HUD? */
  hitPause(x: number, y: number): boolean {
    const b = this.pauseBox();
    const px = x * this.dpr;
    const py = y * this.dpr;
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  }

  /** Size of one HUD font pixel, in device pixels: at least 2 CSS px. */
  private hudPx(): number {
    return Math.max(Math.round(2 * this.dpr), Math.round(this.scale));
  }

  private pauseBox() {
    const u = this.hudPx();
    const size = 13 * u;
    return { x: this.canvas.width - size - 6 * u, y: 6 * u, w: size, h: size };
  }

  resetView(): void {
    this.snapCamera = true;
    this.retract = null;
    this.won = 0;
    this.fade = 0;
    this.fadeHold = 0;
    this.cameoAlpha = 0;
    this.messages = [];
    this.clicks = [];
    this.particles.clear();
    this.roleAlpha.clear();
  }

  /** Mark a press during a replay. */
  click(x: number, y: number): void {
    this.clicks.push({ x, y, t: this.time });
    if (this.clicks.length > 20) this.clicks.shift();
  }

  message(text: string, sub?: string, dur = 2.2, color: string = P.white): void {
    this.messages = this.messages.filter(m => m.text !== text);
    this.messages.push({ text, sub, t0: this.time, dur, color });
  }

  /** React to what happened in the simulation this tick. */
  onEvents(events: SimEvent[], sim: Sim): void {
    this.map = sim.map;
    const g = (v: number) => v / SCALE;
    const M = this.map.metersPer;
    for (const e of events) {
      switch (e.type) {
        case 'land':
          if (e.speed > 6) this.particles.dust(g(e.x), g(e.y), e.speed);
          if (e.speed > 9) this.squash = 0.12;
          if (e.speed > 22) this.shakeAmt = Math.max(this.shakeAmt, Math.min(4, e.speed / 10));
          break;
        case 'bump':
          if (e.speed > 6) this.particles.sparks(g(e.x), g(e.y), e.axis === 'x' ? -Math.sign(sim.state.dude.vx || 1) : 1, e.axis === 'y' ? 1 : 0);
          break;
        case 'spring': {
          const i = this.nearestSpring(e.x, e.y);
          if (i >= 0) this.springs.set(i, { t: this.time, side: this.springSide(i, e.x, e.y, e.axis) });
          this.particles.boing(g(e.x), g(e.y), e.axis === 'x');
          break;
        }
        case 'goopStick':
          this.particles.goop(g(e.x), g(e.y), e.side);
          break;
        case 'goopLetGo':
          this.particles.goop(g(e.x), g(e.y), 'bottom');
          break;
        case 'goopReset':
        case 'teleport':
          this.fade = 1;
          this.fadeHold = 0.25;
          this.snapCamera = true;
          this.retract = null;
          if (e.type === 'goopReset') this.message('BACK TO THE START', undefined, 2.4, P.r2);
          break;
        case 'hookAttach': {
          this.particles.pop(g(e.x), g(e.y));
          const i = this.nearestTarget(e.x, e.y);
          if (i >= 0) this.targetFlash.set(i, this.time);
          break;
        }
        case 'hookCancel':
        case 'hookRelease':
          if (e.type === 'hookCancel' && e.reason === 'blocked') this.particles.sparks(g(e.x), g(e.y), 0, 1);
          this.retract = { x: e.x, y: e.y, t: this.time };
          break;
        case 'fall':
          this.message(`-${Math.round(e.distance / M)} M`, 'OUCH', 1.8, P.r2);
          break;
        case 'cameos':
          this.particles.sparkle(150 / SCALE, 100 / SCALE, 650 / SCALE, 700 / SCALE);
          break;
        case 'win':
          this.won = this.time;
          this.particles.confetti(g(sim.state.dude.x + DUDE.w / 2), g(sim.state.dude.y), 140);
          break;
      }
    }
  }

  private nearestSpring(x: number, y: number): number {
    let best = -1;
    let bestD = Infinity;
    this.map.platforms.forEach((p, i) => {
      if (p.kind !== 'spring') return;
      const dx = Math.max(p.x - x, 0, x - (p.x + p.w));
      const dy = Math.max(p.y - y, 0, y - (p.y + p.h));
      const d = dx + dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD < 40 ? best : -1;
  }

  private springSide(i: number, x: number, y: number, axis: 'x' | 'y'): 'top' | 'bottom' | 'left' | 'right' {
    const p = this.map.platforms[i];
    if (axis === 'x') return x <= p.x + p.w / 2 ? 'left' : 'right';
    return y <= p.y + p.h / 2 ? 'top' : 'bottom';
  }

  private nearestTarget(x: number, y: number): number {
    let best = -1;
    let bestD = Infinity;
    this.map.platforms.forEach((p, i) => {
      if (p.kind !== 'target') return;
      const d = Math.hypot(p.x + p.w / 2 - x, p.y + p.h / 2 - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD < 40 ? best : -1;
  }

  render(f: FrameInput): void {
    this.time = f.t;
    const { sim } = f;
    if (sim.map !== this.map) {
      this.map = sim.map;
      this.snapCamera = true;
    }
    const WPX = worldPx(this.map);
    const s = sim.state;
    const ctx = this.lctx;
    const big = Math.abs(f.prev.dx - s.dude.x) + Math.abs(f.prev.dy - s.dude.y) > 300;
    const a = big ? 1 : f.alpha;
    const dudeX = lerp(f.prev.dx, s.dude.x, a);
    const dudeY = lerp(f.prev.dy, s.dude.y, a);
    const view = sim.dudeView();

    // camera
    const lookAhead = Math.max(-30, Math.min(70, s.dude.vy * 2.2));
    let tx = (dudeX + DUDE.w / 2) / SCALE - this.vw / 2;
    let ty = (dudeY + DUDE.h / 2) / SCALE - this.vh * 0.56 + lookAhead;
    tx = this.vw >= WPX.w ? (WPX.w - this.vw) / 2 : Math.max(0, Math.min(WPX.w - this.vw, tx));
    ty = Math.max(-150, Math.min(WPX.h + 22 - this.vh, ty));
    if (this.snapCamera) {
      this.camX = tx;
      this.camY = ty;
      this.snapCamera = false;
      this.lastDudeX = dudeX;
    } else {
      const k = 1 - Math.exp(-f.dt * 9);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
    }
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeAmt > 0.05 && f.shake) {
      shakeX = Math.round((Math.random() - 0.5) * this.shakeAmt);
      shakeY = Math.round((Math.random() - 0.5) * this.shakeAmt);
    }
    this.shakeAmt *= Math.exp(-f.dt * 10);
    const cx = Math.round(this.camX) + shakeX;
    const cy = Math.round(this.camY) + shakeY;
    const v: View = { x: cx, y: cy, w: this.vw, h: this.vh };

    // wheels
    const moved = dudeX - this.lastDudeX;
    this.lastDudeX = dudeX;
    if (view.stuck) this.wheel += f.dt * 14 * Math.sin(f.t * 5);
    else if (view.airborne) {
      this.wheelSpin *= Math.exp(-f.dt * 1.5);
      this.wheel += this.wheelSpin * f.dt;
    } else {
      const spin = moved / 6.4 / SCALE;
      this.wheel += spin;
      this.wheelSpin = f.dt > 0 ? spin / f.dt : 0;
    }

    // ---- world
    drawSky(ctx, v, f.t, this.map.theme, WPX.h);
    drawBackdrop(ctx, v, f.t, this.map.theme, WPX.h);
    drawGround(ctx, v, WPX.h);
    this.blitStatic(ctx, v);
    this.drawDynamicPlatforms(ctx, f, cx, cy, a, view.grapplesLeft === 0);
    if (s.world.cameos) this.cameoAlpha = Math.min(1, this.cameoAlpha + f.dt * 1.2);
    if (this.map.cameos) drawCameos(ctx, this.map.cameos, cx, cy, f.t, this.cameoAlpha);
    for (const b of BEACONS[this.map.id] ?? []) {
      if (Math.floor(f.t * 1.25 + b.x * 0.001) % 2) continue;
      const bx = Math.round(b.x / SCALE - cx);
      const by = Math.round(b.y / SCALE - cy);
      ctx.globalAlpha = 0.35;
      rect(ctx, bx - 3, by - 3, 7, 7, P.r2);
      ctx.globalAlpha = 1;
      rect(ctx, bx - 1, by - 1, 3, 3, P.r1);
      dot(ctx, bx, by, P.white);
    }

    // rope and dude
    const hook = sim.hookView();
    const hookX = lerp(f.prev.hx, hook.x, a);
    const hookY = lerp(f.prev.hy, hook.y, a);
    const gx = dudeX / SCALE - cx;
    const gy = dudeY / SCALE - cy;
    const pointerWorld = f.pointer && f.interactive ? this.screenToWorld(f.pointer.x, f.pointer.y) : null;
    let aimAt: { x: number; y: number } | null = null;
    if (hook.state !== 'idle') aimAt = { x: hookX, y: hookY };
    else if (this.retract && f.t - this.retract.t < 0.14) aimAt = this.retract;
    else if (pointerWorld && !s.won) aimAt = pointerWorld;
    const facing = s.dude.facing;
    const shoulderWX = dudeX + (facing > 0 ? 9 : SPRITE_W - 1 - 9) * SCALE;
    const shoulderWY = dudeY + 10 * SCALE;
    const aim = aimAt ? Math.atan2(aimAt.y - shoulderWY, aimAt.x - shoulderWX) : null;
    const muzzle = muzzleOf(gx, gy, facing, aim);

    if (hook.state !== 'idle') this.drawRope(ctx, muzzle, { x: hookX / SCALE - cx, y: hookY / SCALE - cy }, s.mode === 'newage' && hook.state === 'attached' ? this.slack(sim) : 0);
    else if (this.retract) {
      const k = (f.t - this.retract.t) / 0.14;
      if (k < 1) {
        const ex = lerp(this.retract.x / SCALE - cx, muzzle.x, k);
        const ey = lerp(this.retract.y / SCALE - cy, muzzle.y, k);
        this.drawRope(ctx, muzzle, { x: ex, y: ey }, 0);
      } else this.retract = null;
    }

    const pose: DudePose = { facing, wheel: this.wheel, aim, loaded: hook.state === 'idle' && !this.retract, stuck: view.stuck, t: f.t, wheels: f.wheels };
    let tilt = 0;
    if (s.won) tilt = Math.min(0.32, (f.t - this.won) * 1.2) * (0.85 + 0.15 * Math.sin(f.t * 6));
    const sq = this.squash > 0 ? 1 : 0;
    this.squash = Math.max(0, this.squash - f.dt);
    let jitter = 0;
    if (view.stuck) jitter = Math.floor(f.t * 16) % 2;
    drawDude(ctx, gx + jitter, gy + sq, pose, tilt);

    // grapple pips above his head while it matters
    if (f.hud && (view.airborne || view.stuck || hook.state === 'attached') && !s.won) {
      for (let i = 0; i < 3; i++) {
        const px = Math.round(gx + 6 + i * 4);
        const py = Math.round(gy - 7);
        const on = i < view.grapplesLeft;
        rect(ctx, px - 1, py - 1, 4, 4, P.ink);
        rect(ctx, px, py, 2, 2, on ? P.c1 : P.s1);
      }
    }

    // wind lines when falling fast
    if (s.dude.vy > 16 && !view.stuck) {
      const n = Math.min(8, Math.floor((s.dude.vy - 14) / 2));
      for (let i = 0; i < n; i++) {
        const lx = Math.round(gx - 10 + ((i * 37 + Math.floor(f.t * 60) * 7) % (SPRITE_W + 20)));
        const ly = Math.round(gy + SPRITE_H - ((f.t * 400 + i * 23) % 70));
        rect(ctx, lx, ly, 1, 6, 'rgba(246,246,242,0.45)');
      }
    }

    this.particles.update(f.dt);
    this.particles.draw(ctx, cx, cy);

    if (f.interactive && f.pointer && !s.won) this.drawAim(ctx, f, sim, muzzle, cx, cy, pointerWorld!);

    // replay: show where each press landed
    this.clicks = this.clicks.filter(c => f.t - c.t < 0.5);
    for (const c of this.clicks) {
      const k = (f.t - c.t) / 0.5;
      const r = Math.round(2 + k * 7);
      const px = Math.round(c.x / SCALE - cx);
      const py = Math.round(c.y / SCALE - cy);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = P.y2;
      ctx.strokeRect(px - r + 0.5, py - r + 0.5, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }

    // fade (goop reset / teleport)
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(13,11,32,${Math.min(1, this.fade)})`;
      ctx.fillRect(0, 0, this.vw, this.vh);
      if (this.fadeHold > 0) this.fadeHold -= f.dt;
      else this.fade = Math.max(0, this.fade - f.dt * 2.5);
    }

    // ---- upscale
    const out = this.ctx;
    if (Math.abs(this.scale - this.k) < 1e-6) {
      // a whole-number scale: one nearest-neighbour blit
      out.imageSmoothingEnabled = false;
      out.drawImage(this.low, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      // The mid canvas is never more than 2x the output, so plain bilinear is enough for
      // the smooth step (and much cheaper on the GPU than 'high').
      this.mctx.imageSmoothingEnabled = false;
      this.mctx.drawImage(this.low, 0, 0, this.mid.width, this.mid.height);
      out.imageSmoothingEnabled = true;
      out.imageSmoothingQuality = 'low';
      out.drawImage(this.mid, 0, 0, this.canvas.width, this.canvas.height);
    }

    if (f.hud) this.drawHud(f, sim);
  }

  private blitStatic(ctx: Ctx, v: View): void {
    const st = this.staticFor();
    const sx = Math.max(0, v.x);
    const sy = Math.max(0, v.y);
    const ex = Math.min(st.width, v.x + v.w);
    const ey = Math.min(st.height, v.y + v.h);
    if (ex > sx && ey > sy) ctx.drawImage(st, sx, sy, ex - sx, ey - sy, sx - v.x, sy - v.y, ex - sx, ey - sy);
  }

  private drawDynamicPlatforms(ctx: Ctx, f: FrameInput, cx: number, cy: number, a: number, spent: boolean): void {
    const s = f.sim.state;
    const plats = this.map.platforms;
    for (let i = 0; i < plats.length; i++) {
      const def = plats[i];
      if (def.onlyIn && def.onlyIn !== s.mode) continue;
      const wx = lerp(f.prev.platX[i] ?? s.world.platX[i], s.world.platX[i], a);
      const b = toPx({ x: wx, y: def.y, w: def.w, h: def.h });
      const x = b.x - cx;
      const y = b.y - cy;
      if (x > this.vw + 10 || y > this.vh + 10 || x + b.w < -10 || y + b.h < -10) continue;

      let alpha = 1;
      if (def.role) {
        const want = isVisible(def, s.world) ? 1 : 0;
        const cur = this.roleAlpha.get(i) ?? want;
        const next = want > cur ? Math.min(1, cur + f.dt * 5) : want < cur ? Math.max(0, cur - f.dt * 5) : cur;
        this.roleAlpha.set(i, next);
        alpha = next;
        if (alpha <= 0) continue;
        // flicker while changing
        if (alpha < 1 && Math.floor(f.t * 30) % 2) continue;
      }

      if (def.kind === 'target') {
        const flash = this.targetFlash.get(i);
        const bright = Math.sin(f.t * 3 + i) > 0.3;
        ctx.drawImage(targetSprite(spent ? 'dim' : bright ? 'bright' : 'normal'), x - 1, y - 1);
        if (flash !== undefined && f.t - flash < 0.35) {
          const k = Math.round(((f.t - flash) / 0.35) * 8);
          ctx.globalAlpha = 1 - (f.t - flash) / 0.35;
          ctx.strokeStyle = P.white;
          ctx.strokeRect(x - k - 0.5, y - k - 0.5, b.w + 2 * k + 1, b.h + 2 * k + 1);
          ctx.globalAlpha = 1;
        }
      } else if (def.kind === 'spring') {
        const hit = this.springs.get(i);
        let comp = 0;
        if (hit) {
          const dt = f.t - hit.t;
          comp = dt < 0.35 ? Math.max(0, Math.sin(Math.min(1, dt / 0.3) * Math.PI)) * Math.exp(-dt * 4) : 0;
        }
        drawSpring(ctx, { x, y, w: b.w, h: b.h }, comp, hit?.side ?? 'top');
      } else if (def.kind === 'goop') {
        const art = this.artFor(i);
        if (art) ctx.drawImage(art, x - 1, y - 1);
        drawGoopLife(ctx, { x, y, w: b.w, h: b.h }, f.t, i);
      } else if (def.kind === 'girder' && (def.mover || def.role)) {
        const art = this.artFor(i)!;
        ctx.globalAlpha = alpha;
        ctx.drawImage(art, x, y);
        ctx.globalAlpha = 1;
        if (def.mover) {
          const dir = Math.sign(s.world.platDx[i]) || 1;
          const midY = y + Math.floor(b.h / 2);
          for (let k = 0; k < 3; k++) {
            const mx = x + Math.floor(b.w / 2) + (k - 1) * 5;
            const on = (Math.floor(f.t * 6) - k * dir + 30) % 3 === 0;
            const c = on ? P.y2 : P.y0;
            dot(ctx, mx - dir, midY - 2, c);
            dot(ctx, mx, midY - 1, c);
            dot(ctx, mx + dir, midY, c);
            dot(ctx, mx, midY + 1, c);
            dot(ctx, mx - dir, midY + 2, c);
          }
        }
      }
    }
  }

  /** How slack the New Age rope is (0 = taut). */
  private slack(sim: Sim): number {
    const h = sim.state.newage!.hook;
    const hand = handOf(sim.state.dude);
    const d = Math.hypot(hand.x - h.x, hand.y - h.y);
    return Math.max(0, Math.min(1, (h.len - d) / 40));
  }

  private drawRope(ctx: Ctx, from: { x: number; y: number }, to: { x: number; y: number }, slack: number): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const sag = slack * Math.min(18, len * 0.2);
    const steps = Math.max(1, Math.ceil(len / 6));
    // a dark shadow line one pixel below keeps the rope readable on bright sky
    for (const pass of [0, 1]) {
      let px = from.x;
      let py = from.y + (pass ? 0 : 1);
      let n = 0;
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        const x = from.x + dx * u;
        const y = from.y + dy * u + Math.sin(u * Math.PI) * sag + (pass ? 0 : 1);
        line(ctx, px, py, x, y, pass ? () => ((n++ >> 1) % 2 ? P.ropeD : P.rope) : 'rgba(26,28,44,0.55)');
        px = x;
        py = y;
      }
    }
    // the plunger: wooden stick and red cup facing along the rope
    const ang = Math.atan2(dy, dx);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    dot(ctx, to.x - ux * 2, to.y - uy * 2, P.wood);
    dot(ctx, to.x - ux * 3, to.y - uy * 3, P.woodD);
    for (let j = -1; j <= 1; j++) dot(ctx, to.x - uy * j, to.y + ux * j, P.r1);
    dot(ctx, to.x + ux, to.y + uy, P.r0);
  }

  /** Dotted aim guide toward the cursor, stopping where the plunger would. */
  private drawAim(ctx: Ctx, f: FrameInput, sim: Sim, muzzle: { x: number; y: number }, cx: number, cy: number, target: { x: number; y: number }): void {
    const s = sim.state;
    const px = Math.round(target.x / SCALE - cx);
    const py = Math.round(target.y / SCALE - cy);
    const can = sim.canFireAt(target.x, target.y) && sim.hookView().state === 'idle';
    const crossColor = can ? P.white : P.r2;
    if (f.aimGuide && can) {
      // where would the plunger go?
      let ox: number;
      let oy: number;
      let range: number;
      if (s.original) {
        ox = s.dude.x + 14 + HOOK_SIZE / 2;
        oy = s.dude.y - 20 + HOOK_SIZE / 2;
        range = HOOK_RANGE;
      } else {
        const hand = handOf(s.dude);
        ox = hand.x;
        oy = hand.y;
        range = NA.hookRange;
      }
      const dx = target.x - ox;
      const dy = target.y - oy;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      let hit: 'target' | 'solid' | 'none' = 'none';
      let hitIndex = -1;
      let dist = 0;
      const pad = s.original ? HOOK_SIZE / 2 : NA.hookRadius;
      for (; dist < range; dist += 4) {
        const hx = ox + ux * dist;
        const hy = oy + uy * dist;
        const plats = this.map.platforms;
        for (let i = 0; i < plats.length && hit === 'none'; i++) {
          const def = plats[i];
          if (!isVisible(def, s.world) || def.kind === 'goal') continue;
          if (s.newage && def.kind === 'spring' && def.w > def.h) continue;
          const bx = s.world.platX[i];
          if (s.newage && def.kind === 'target' && nearHand(s.dude, { x: bx, y: def.y, w: def.w, h: def.h })) continue;
          if (hx + pad > bx && hx - pad < bx + def.w && hy + pad > def.y && hy - pad < def.y + def.h) {
            hit = def.kind === 'target' ? 'target' : 'solid';
            hitIndex = i;
          }
        }
        if (hit !== 'none') break;
      }
      // dashes with a dark shadow, so the line reads against sky, girders and goop alike
      const color = hit === 'target' ? P.c2 : P.white;
      const steps = Math.floor(dist / SCALE);
      for (const pass of [0, 1]) {
        ctx.globalAlpha = pass ? (hit === 'target' ? 1 : 0.8) : 0.6;
        for (let i = 6; i < steps; i++) {
          if (i % 6 >= 3) continue;
          const gx = Math.round(ox / SCALE - cx + ux * i);
          const gy = Math.round(oy / SCALE - cy + uy * i);
          if (pass) dot(ctx, gx, gy, color);
          else rect(ctx, gx, gy + 1, 1, 1, P.ink);
        }
      }
      ctx.globalAlpha = 1;
      if (hit === 'target' && hitIndex >= 0) {
        const def = this.map.platforms[hitIndex];
        const bx = Math.round(s.world.platX[hitIndex] / SCALE - cx);
        const by = Math.round(def.y / SCALE - cy);
        const pulse = Math.floor(f.t * 8) % 2;
        ctx.strokeStyle = P.c2;
        ctx.strokeRect(bx - 2.5 - pulse, by - 2.5 - pulse, 13 + 5 + pulse * 2, 13 + 5 + pulse * 2);
      } else if (hit === 'solid') {
        const ex = Math.round(ox / SCALE - cx + ux * (dist / SCALE));
        const ey = Math.round(oy / SCALE - cy + uy * (dist / SCALE));
        dot(ctx, ex - 1, ey - 1, P.r2);
        dot(ctx, ex + 1, ey + 1, P.r2);
        dot(ctx, ex + 1, ey - 1, P.r2);
        dot(ctx, ex - 1, ey + 1, P.r2);
        dot(ctx, ex, ey, P.r2);
      }
      void muzzle;
    }
    drawCrosshair(ctx, px, py, crossColor, f.cursor, can);
  }

  private drawHud(f: FrameInput, sim: Sim): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const u = this.hudPx();
    const s = sim.state;
    const pad = 6 * u;
    let y = pad;
    if (f.showTimer) {
      drawTextOutlined(ctx, formatTime(s.stats.ticks), pad, y, P.white, P.ink, u * 2);
      y += 18 * u;
    }
    const M = this.map.metersPer;
    const h = Math.max(0, Math.round(heightOf(this.map, s.dude.y) / M));
    const best = Math.round(s.stats.bestHeight / M);
    drawTextOutlined(ctx, `HEIGHT ${h}M`, pad, y, P.y2, P.ink, u);
    y += 10 * u;
    drawTextOutlined(ctx, `BEST ${best}M`, pad, y, P.s4, P.ink, u);
    y += 10 * u;
    drawTextOutlined(ctx, `FALLS ${s.stats.falls}`, pad, y, P.s4, P.ink, u);
    if (s.mode === 'original' && s.stats.goopResets > 0) {
      y += 10 * u;
      drawTextOutlined(ctx, `GOOPED ${s.stats.goopResets}`, pad, y, P.p4, P.ink, u);
    }

    // pause button (or the replay label) and mode tag (top right)
    const b = this.pauseBox();
    if (f.replay) {
      const label = f.replay.paused ? 'REPLAY  PAUSED' : `REPLAY  ${f.replay.speed}X`;
      drawTextOutlined(ctx, label, this.canvas.width - textWidth(label, u * 2) - 6 * u, b.y, P.y2, P.ink, u * 2);
    } else {
      rect(ctx, b.x - u, b.y - u, b.w + 2 * u, b.h + 2 * u, P.ink);
      rect(ctx, b.x, b.y, b.w, b.h, 'rgba(26,28,44,0.75)');
      rect(ctx, b.x + 4 * u, b.y + 3 * u, 2 * u, 7 * u, P.white);
      rect(ctx, b.x + 7 * u, b.y + 3 * u, 2 * u, 7 * u, P.white);
    }
    const tag = s.mode === 'original' ? 'ORIGINAL' : 'NEW AGE';
    const tagY = f.replay ? b.y + 18 * u : b.y + 3 * u;
    const tagX = f.replay ? this.canvas.width - textWidth(tag, u) - 6 * u : b.x - textWidth(tag, u) - 5 * u;
    drawTextOutlined(ctx, tag, tagX, tagY, s.mode === 'original' ? P.r2 : P.c2, P.ink, u);
    if (f.debug) drawTextOutlined(ctx, `DEBUG: KEYS 1-${this.map.teleports.length} TELEPORT`, pad, this.canvas.height - 12 * u, P.y1, P.ink, u);

    // messages
    this.messages = this.messages.filter(m => f.t - m.t0 < m.dur);
    let my = Math.round(this.canvas.height * 0.18);
    for (const m of this.messages) {
      const age = f.t - m.t0;
      if (age > m.dur - 0.3 && Math.floor(age * 20) % 2) continue;
      // as big as fits: 3 HUD pixels per font pixel, smaller on narrow screens
      const fit = Math.max(1, Math.floor((this.canvas.width * 0.9) / Math.max(1, textWidth(m.text, 1))));
      const s2 = Math.min(u * 3, fit);
      const s3 = Math.max(1, Math.min(u * 2, Math.floor((this.canvas.width * 0.9) / Math.max(1, textWidth(m.sub ?? '', 1)))));
      drawTextOutlined(ctx, m.text, Math.round((this.canvas.width - textWidth(m.text, s2)) / 2), my, m.color, P.ink, s2);
      my += 10 * s2;
      if (m.sub) {
        drawTextOutlined(ctx, m.sub, Math.round((this.canvas.width - textWidth(m.sub, s3)) / 2), my - 4 * s2 + 2 * u, P.s4, P.ink, s3);
        my += 6 * u;
      }
    }
    void drawText;
  }
}

export function formatTime(ticks: number): string {
  const total = ticks / 60;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = Math.floor(total % 60);
  const tenth = Math.floor((total * 10) % 10);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}.${tenth}`;
}

/**
 * The aiming crosshair, in game px: four arms around a centre dot, outlined in ink so it
 * stands out on any background. Red with no centre gap when a press wouldn't fire.
 */
function drawCrosshair(ctx: Ctx, px: number, py: number, color: string, size: 'small' | 'medium' | 'large', can: boolean): void {
  const { gap, arm, thick } = size === 'small' ? { gap: 2, arm: 2, thick: 1 } : size === 'medium' ? { gap: 3, arm: 6, thick: 1 } : { gap: 3, arm: 8, thick: 2 };
  const t0 = -Math.floor((thick - 1) / 2);
  const arms = [
    { x: px + t0, y: py - gap - arm, w: thick, h: arm },
    { x: px + t0, y: py + gap + 1, w: thick, h: arm },
    { x: px - gap - arm, y: py + t0, w: arm, h: thick },
    { x: px + gap + 1, y: py + t0, w: arm, h: thick },
  ];
  for (const a of arms) rect(ctx, a.x - 1, a.y - 1, a.w + 2, a.h + 2, P.ink);
  if (size !== 'small' || !can) rect(ctx, px + t0 - 1, py + t0 - 1, thick + 2, thick + 2, P.ink);
  for (const a of arms) rect(ctx, a.x, a.y, a.w, a.h, color);
  if (size !== 'small' || !can) rect(ctx, px + t0, py + t0, thick, thick, color);
}
