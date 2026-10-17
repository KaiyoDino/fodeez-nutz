// The game shell: fixed 60 Hz simulation, rendering, input, menus, saving.

import { Audio } from '../audio/audio';
import { Renderer, snapshot, type Snapshot } from '../render/renderer';
import { heightOf, LEVEL } from '../sim/level';
import { Sim } from '../sim/sim';
import { randomSeed } from '../sim/rng';
import type { InputEvent, Mode, SimEvent } from '../sim/types';
import { TICK_RATE } from '../sim/types';
import { loadSave, writeSave, type SaveData, type Settings } from './save';
import { UI } from './ui';

const TICK = 1 / TICK_RATE;
type Phase = 'title' | 'playing' | 'paused' | 'won';

export interface DebugOptions {
  enabled: boolean;
  mode?: Mode;
  at?: { x: number; y: number };
  menu?: string;
  ticks?: number;
  /** Don't advance the simulation (for screenshots). */
  freeze?: boolean;
  /** Pretend the pointer is here (CSS px), for screenshots of the aim guide. */
  pointer?: { x: number; y: number };
}

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private audio = new Audio();
  private ui: UI;
  private save: SaveData;
  private phase: Phase = 'title';
  private sim: Sim;
  private prev: Snapshot;
  private attract: Sim;
  private attractPrev: Snapshot;
  private acc = 0;
  private inputs: InputEvent[] = [];
  private pointer: { x: number; y: number } | null = null;
  private pointerDown = false;
  private spaceDown = false;
  private last = performance.now();
  private time = 0;
  private saveTimer = 0;
  private winTimer = -1;
  private debug: DebugOptions;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, debug: DebugOptions) {
    this.canvas = canvas;
    this.debug = debug;
    this.renderer = new Renderer(canvas);
    this.save = loadSave();
    this.audio.setVolumes(this.save.settings.music, this.save.settings.sfx);
    this.audio.playMusic(true);
    this.sim = Sim.create('original', 1);
    this.prev = snapshot(this.sim);
    this.attract = Sim.create('original', 12345);
    this.attractPrev = snapshot(this.attract);
    this.ui = new UI(uiRoot, {
      play: (mode, fresh) => this.play(mode, fresh),
      resume: () => this.resume(),
      restart: () => this.play(this.sim.mode, true),
      quitToTitle: () => this.quitToTitle(),
      settingsChanged: s => this.applySettings(s),
      toggleFullscreen: () => this.toggleFullscreen(),
      sound: k => this.audio.ui(k),
    });
    this.bindInput();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.onResize());
  }

  start(): void {
    const d = this.debug;
    if (d.enabled && d.mode) {
      this.play(d.mode, true);
      if (d.at) {
        this.sim.state.dude.x = d.at.x;
        this.sim.state.dude.y = d.at.y;
        this.sim.state.airPeakY = d.at.y;
        if (this.sim.state.original) {
          this.sim.state.original.hookX = d.at.x + 14;
          this.sim.state.original.hookY = d.at.y - 20;
        }
        this.prev = snapshot(this.sim);
        this.renderer.resetView();
      }
      for (let i = 0; i < (d.ticks ?? 0); i++) this.tick();
      if (d.menu === 'pause') this.pause();
      if (d.menu === 'win') {
        this.sim.state.won = true;
        this.onWin();
        this.winTimer = 0.01;
      }
    } else {
      this.showTitle();
      if (d.enabled && d.menu === 'modes') this.ui.showModes(this.save);
      if (d.enabled && d.menu === 'settings') this.ui.showSettings(this.save.settings, () => this.showTitle());
      if (d.enabled && d.menu === 'howto') this.ui.showHowTo(() => this.showTitle());
    }
    requestAnimationFrame(t => this.frame(t));
  }

  // ------------------------------------------------------------ flow

  private showTitle(): void {
    this.phase = 'title';
    this.canvas.classList.remove('playing');
    this.renderer.resetView();
    this.ui.showTitle(this.save);
  }

  private play(mode: Mode, fresh: boolean): void {
    const saved = fresh ? null : this.save.runs[mode];
    this.sim = saved ? new Sim(structuredClone(saved)) : Sim.create(mode, randomSeed());
    this.prev = snapshot(this.sim);
    this.save.lastMode = mode;
    if (fresh) this.save.runs[mode] = null;
    this.persist();
    this.acc = 0;
    this.inputs = [];
    this.pointerDown = false;
    this.winTimer = -1;
    this.phase = 'playing';
    this.canvas.classList.add('playing');
    this.renderer.resetView();
    this.ui.hide();
    if (!saved) this.renderer.message(mode === 'original' ? 'ORIGINAL' : 'NEW AGE', 'GOOD LUCK', 2.4, mode === 'original' ? '#ff8a8d' : '#9ff3ff');
  }

  private pause(): void {
    if (this.phase !== 'playing') return;
    this.releasePointer();
    this.phase = 'paused';
    this.canvas.classList.remove('playing');
    this.persist();
    this.ui.showPause(this.sim.mode, this.save);
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.canvas.classList.add('playing');
    this.acc = 0;
    this.prev = snapshot(this.sim);
    this.ui.hide();
  }

  private quitToTitle(): void {
    this.persist();
    this.showTitle();
  }

  private onWin(): void {
    if (this.phase === 'won') return;
    const mode = this.sim.mode;
    const stats = this.sim.state.stats;
    const prevBest = this.save.best[mode];
    const isNewBest = !prevBest || stats.ticks < prevBest.ticks;
    if (isNewBest) this.save.best[mode] = { ticks: stats.ticks, falls: stats.falls, date: new Date().toISOString() };
    this.save.wins[mode]++;
    this.save.runs[mode] = null;
    writeSave(this.save);
    this.phase = 'won';
    this.canvas.classList.remove('playing');
    this.winTimer = 1.6;
    this.winInfo = { isNewBest, prevBest: prevBest ?? null };
  }
  private winInfo: { isNewBest: boolean; prevBest: SaveData['best'][Mode] } = { isNewBest: false, prevBest: null };

  private persist(): void {
    if (this.phase === 'playing' || this.phase === 'paused') {
      if (!this.sim.state.won) this.save.runs[this.sim.mode] = this.sim.state;
    }
    writeSave(this.save);
  }

  private applySettings(s: Settings): void {
    this.save.settings = s;
    this.audio.setVolumes(s.music, s.sfx);
    writeSave(this.save);
  }

  private toggleFullscreen(): void {
    // Fullscreen can be refused (embedded pages, some phones); that's fine, the game works without it.
    try {
      const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
      p?.catch(() => undefined);
    } catch {
      // not available here
    }
  }

  // ------------------------------------------------------------ input

  private bindInput(): void {
    const c = this.canvas;
    const local = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    window.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { capture: true });

    c.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const p = local(e);
      this.pointer = p;
      if (this.phase !== 'playing') return;
      if (this.renderer.hitPause(p.x, p.y)) {
        this.pause();
        return;
      }
      e.preventDefault();
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // capture can fail for synthetic events
      }
      this.press(p);
    });
    c.addEventListener('pointermove', e => {
      this.pointer = local(e);
    });
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') this.pointer = null;
      if (this.pointerDown) this.release();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', e => {
      if (!this.pointerDown && e.pointerType === 'mouse') this.pointer = null;
    });
    c.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (this.phase === 'playing') {
          e.preventDefault();
          this.audio.ui('select');
          this.pause();
        }
        return;
      }
      if (this.phase !== 'playing' || this.ui.open) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.spaceDown = true;
        this.press(this.pointer ?? this.defaultAimPoint());
      } else if ((e.key === 'f' || e.key === 'F') && !e.repeat) this.toggleFullscreen();
      else if (this.debug.enabled && /^[1-4]$/.test(e.key)) {
        const ev = this.sim.teleport(Number(e.key) - 1);
        this.handleEvents(ev);
        this.prev = snapshot(this.sim);
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space' && this.spaceDown) {
        this.spaceDown = false;
        this.release();
      }
    });
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => {
      this.audio.suspend(document.hidden);
      if (document.hidden) {
        this.pause();
        this.persist();
      }
    });
    window.addEventListener('pagehide', () => this.persist());
  }

  /** CSS point straight above the dude, for Space when the mouse hasn't moved yet. */
  private defaultAimPoint(): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.width / 2, y: r.height * 0.2 };
  }

  private press(p: { x: number; y: number }): void {
    const w = this.renderer.screenToWorld(p.x, p.y);
    this.inputs.push({ kind: 'press', x: w.x, y: w.y });
    this.pointerDown = true;
  }

  private release(): void {
    const p = this.pointer ?? this.defaultAimPoint();
    const w = this.renderer.screenToWorld(p.x, p.y);
    this.inputs.push({ kind: 'release', x: w.x, y: w.y });
    this.pointerDown = false;
  }

  private releasePointer(): void {
    if (this.pointerDown || this.spaceDown) {
      this.release();
      this.spaceDown = false;
    }
  }

  // ------------------------------------------------------------ loop

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h, window.devicePixelRatio || 1);
  }

  private tick(): void {
    this.prev = snapshot(this.sim);
    const events = this.sim.step(this.inputs.splice(0));
    this.handleEvents(events);
  }

  private handleEvents(events: SimEvent[]): void {
    if (!events.length) return;
    this.renderer.onEvents(events, this.sim);
    this.audio.onEvents(events);
    for (const e of events) if (e.type === 'win') this.onWin();
  }

  private frame(now: number): void {
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;

    let sim = this.sim;
    let prev = this.prev;
    let alpha = 1;
    if (this.phase === 'playing' && this.debug.freeze) {
      if (this.debug.pointer) this.pointer = this.debug.pointer;
    } else if (this.phase === 'playing') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < 8) {
        this.tick();
        this.acc -= TICK;
        steps++;
        if (this.phase !== 'playing') break;
      }
      if (steps === 8) this.acc = 0;
      alpha = Math.min(1, this.acc / TICK);
      prev = this.prev;
      this.saveTimer += dt;
      if (this.saveTimer > 2) {
        this.saveTimer = 0;
        this.persist();
      }
    } else if (this.phase === 'title') {
      // the attract demo: he just rolls back and forth at the bottom
      this.acc += dt;
      while (this.acc >= TICK) {
        this.attractPrev = snapshot(this.attract);
        this.attract.step();
        this.acc -= TICK;
      }
      sim = this.attract;
      prev = this.attractPrev;
      alpha = this.acc / TICK;
    } else if (this.phase === 'won' && this.winTimer > 0) {
      this.winTimer -= dt;
      if (this.winTimer <= 0) {
        const mode = this.sim.mode;
        this.ui.showWin(mode, this.sim.state.stats, this.winInfo.prevBest, this.winInfo.isNewBest, () => this.play(mode, true), () => this.showTitle());
      }
    }

    const height = heightOf(sim.state.dude.y);
    this.audio.setIntensity(this.phase === 'title' ? 0.2 : height / 2600);
    this.audio.update(sim, this.phase === 'playing');

    const s = this.save.settings;
    this.renderer.render({
      sim,
      prev,
      alpha,
      t: this.time,
      dt,
      pointer: this.pointer,
      aimGuide: s.aimGuide,
      showTimer: s.showTimer,
      shake: s.shake,
      hud: this.phase === 'playing' || this.phase === 'paused',
      interactive: this.phase === 'playing',
      debug: this.debug.enabled,
    });
    requestAnimationFrame(t => this.frame(t));
  }

  /** Test hooks (only exposed in debug mode). */
  debugApi() {
    return {
      state: () => this.sim.state,
      phase: () => this.phase,
      play: (mode: Mode, fresh = true) => this.play(mode, fresh),
      input: (ev: InputEvent) => this.inputs.push(ev),
      levelSize: () => LEVEL.length,
      /** Start a run with this seed and fast-forward through recorded inputs (as the real game would play them). */
      runRoute: (route: { mode: Mode; seed: number; inputs: (InputEvent & { tick: number })[] }) => {
        this.play(route.mode, true);
        this.sim = Sim.create(route.mode, route.seed);
        this.prev = snapshot(this.sim);
        const byTick = new Map<number, InputEvent[]>();
        for (const i of route.inputs) byTick.set(i.tick, [...(byTick.get(i.tick) ?? []), { kind: i.kind, x: i.x, y: i.y }]);
        const last = Math.max(0, ...route.inputs.map(i => i.tick)) + 600;
        while (!this.sim.state.won && this.sim.state.stats.ticks < last) {
          this.inputs.push(...(byTick.get(this.sim.state.stats.ticks) ?? []));
          this.tick();
        }
        return this.sim.state.won;
      },
    };
  }
}
