// Little pixel particles, all in game px. Purely cosmetic: they never touch the simulation.

import { P } from './palette';
import { type Ctx } from './px';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  color: string;
  size: number;
  drag: number;
}

const MAX = 600;

export class Particles {
  private list: Particle[] = [];

  private add(p: Partial<Particle> & { x: number; y: number }): void {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({ vx: 0, vy: 0, g: 0, life: 0, max: 0.5, color: P.white, size: 1, drag: 0, ...p });
  }

  clear(): void {
    this.list.length = 0;
  }

  dust(x: number, y: number, strength: number): void {
    const n = Math.min(14, 3 + Math.floor(strength / 2));
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      this.add({ x: x + dir * (2 + Math.random() * 6), y: y - Math.random() * 2, vx: dir * (10 + Math.random() * 30), vy: -Math.random() * 18, g: 30, drag: 3, max: 0.35 + Math.random() * 0.25, color: Math.random() < 0.5 ? P.white : P.s4 });
    }
  }

  sparks(x: number, y: number, dirX: number, dirY: number): void {
    for (let i = 0; i < 6; i++) {
      const a = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 1.6;
      const s = 40 + Math.random() * 50;
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 80, drag: 2, max: 0.25 + Math.random() * 0.15, color: Math.random() < 0.5 ? P.y2 : P.y1 });
    }
  }

  goop(x: number, y: number, side: 'top' | 'bottom' | 'left' | 'right'): void {
    const nx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
    const ny = side === 'top' ? -1 : side === 'bottom' ? 1 : 0;
    for (let i = 0; i < 12; i++) {
      const spread = (Math.random() - 0.5) * 2;
      this.add({ x, y, vx: nx * (20 + Math.random() * 40) + (ny ? spread * 40 : spread * 10), vy: ny * (20 + Math.random() * 40) + (nx ? spread * 40 : spread * 10) - 10, g: 120, drag: 1, max: 0.4 + Math.random() * 0.3, color: Math.random() < 0.6 ? P.p2 : P.p3, size: Math.random() < 0.3 ? 2 : 1 });
    }
  }

  boing(x: number, y: number, horizontal: boolean): void {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.add({ x, y, vx: Math.cos(a) * (horizontal ? 30 : 60), vy: Math.sin(a) * (horizontal ? 60 : 30), drag: 4, max: 0.3, color: P.y2 });
    }
  }

  pop(x: number, y: number): void {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.add({ x, y, vx: Math.cos(a) * 35, vy: Math.sin(a) * 35, drag: 5, max: 0.22, color: i % 2 ? P.white : P.c1 });
    }
  }

  confetti(x: number, y: number, n = 80): void {
    const cols = [P.r1, P.y1, P.c1, P.green, P.p3, P.white, P.o1];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = 60 + Math.random() * 120;
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 70, drag: 1.2, max: 1.6 + Math.random() * 1.6, color: cols[i % cols.length], size: Math.random() < 0.4 ? 2 : 1 });
    }
  }

  sparkle(x: number, y: number, w: number, h: number): void {
    for (let i = 0; i < 24; i++) this.add({ x: x + Math.random() * w, y: y + Math.random() * h, vy: -8 - Math.random() * 10, max: 0.6 + Math.random() * 0.6, color: Math.random() < 0.5 ? P.y2 : P.white });
  }

  update(dt: number): void {
    for (const p of this.list) {
      p.life += dt;
      p.vy += p.g * dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter(p => p.life < p.max);
  }

  /** Draw with the camera at (camX, camY) in game px. */
  draw(ctx: Ctx, camX: number, camY: number): void {
    for (const p of this.list) {
      const fade = 1 - p.life / p.max;
      if (fade < 0.15 && ((p.life * 30) | 0) % 2) continue; // flicker out
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - camX), Math.round(p.y - camY), p.size, p.size);
    }
  }
}
