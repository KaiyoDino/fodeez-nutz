// The game shell: fixed 60 Hz simulation, rendering, input, menus, saving, replays.

import { Audio } from '../audio/audio';
import { Renderer, snapshot, type Snapshot } from '../render/renderer';
import { getMap, heightOf, MAPS, type MapId } from '../sim/level';
import { isReplay, mapHash, PHYSICS_VERSION, quantize, type RecordedInput, type Replay } from '../sim/replay';
import { randomSeed } from '../sim/rng';
import { Sim } from '../sim/sim';
import type { InputEvent, Mode, SimEvent } from '../sim/types';
import { TICK_RATE } from '../sim/types';
import { ReplayPlayer, SPEEDS } from './replay-player';
import { loadSave, runKey, writeSave, ZOOM, type Best, type RunKey, type SaveData, type Settings } from './save';
import { modeName, UI } from './ui';

const TICK = 1 / TICK_RATE;
type Phase = 'title' | 'playing' | 'paused' | 'won' | 'replay';
/** A run with more inputs than this stops recording (it would bloat the save). */
const MAX_RECORDED = 200_000;

// The bot's winning routes ship with the game as replays.
const BOT_FILES = import.meta.glob('../data/routes/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const BOT_REPLAYS: Partial<Record<RunKey, Replay>> = {};
for (const raw of Object.values(BOT_FILES)) if (isReplay(raw)) BOT_REPLAYS[runKey(raw.map, raw.mode)] = raw;

export interface DebugOptions {
  enabled: boolean;
  map?: MapId;
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
  /** Every input of the current run, for its replay (null if the run started before replays existed). */
  private recorded: RecordedInput[] | null = [];
  private attract: Sim;
  private attractPrev: Snapshot;
  private player: ReplayPlayer | null = null;
  private replayBack: () => void = () => this.showTitle();
  private replayEnded = false;
  private acc = 0;
  private inputs: InputEvent[] = [];
  private pointer: { x: number; y: number } | null = null;
  private pointerDown = false;
  private spaceDown = false;
  private last = performance.now();
  private time = 0;
  private saveTimer = 0;
  private winTimer = -1;
  private winInfo: { isNewBest: boolean; prevBest: Best | undefined; replay: Replay | null } = { isNewBest: false, prevBest: undefined, replay: null };
  private debug: DebugOptions;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, debug: DebugOptions) {
    this.canvas = canvas;
    this.debug = debug;
    this.renderer = new Renderer(canvas);
    this.save = loadSave();
    this.audio.setVolumes(this.save.settings.music, this.save.settings.sfx);
    this.audio.prime();
    this.audio.playMusic(true);
    this.sim = Sim.create('original', 1);
    this.prev = snapshot(this.sim);
    this.attract = Sim.create('original', 12345, this.save.last?.map ?? 'tower');
    this.attractPrev = snapshot(this.attract);
    this.ui = new UI(uiRoot, {
      play: (map, mode, fresh) => this.play(map, mode, fresh),
      resume: () => this.resume(),
      restart: () => this.play(this.sim.mapId, this.sim.mode, true),
      quitToTitle: () => this.quitToTitle(),
      settingsChanged: s => this.applySettings(s),
      toggleFullscreen: () => this.toggleFullscreen(),
      watch: (replay, title, back) => this.watch(replay, title, back),
      openReplays: back => this.ui.showReplays(this.save, BOT_REPLAYS, back),
      sound: k => this.audio.ui(k),
    });
    this.bindInput();
    this.renderer.setZoom(ZOOM[this.save.settings.zoom]);
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.onResize());
  }

  start(): void {
    const d = this.debug;
    if (d.enabled && d.mode) {
      this.play(d.map ?? 'tower', d.mode, true);
      if (d.at) {
        this.sim.state.dude.x = d.at.x;
        this.sim.state.dude.y = d.at.y;
        this.sim.state.airPeakY = d.at.y;
        if (this.sim.state.original) {
          this.sim.state.original.hookX = d.at.x + 14;
          this.sim.state.original.hookY = d.at.y - 20;
        }
        this.recorded = null; // a placed run can't be replayed
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
    } else if (!d.enabled && !this.audio.running) {
      // Sound needs a click or key press first. If the browser allows autoplay, the audio
      // starts by itself a moment later and the start screen goes straight away.
      this.phase = 'title';
      this.ui.showGate(() => {
        this.audio.unlock();
        this.showTitle();
      });
      this.audio.onRunning(() => {
        if (this.phase !== 'title' || !this.ui.gateOpen) return;
        this.ui.closeGate();
        this.showTitle();
      });
    } else {
      this.showTitle();
      if (d.enabled && d.menu === 'maps') this.ui.showMaps(this.save);
      if (d.enabled && d.menu === 'modes') this.ui.showModes(this.save, d.map ?? 'tower');
      if (d.enabled && d.menu === 'replays') this.ui.showReplays(this.save, BOT_REPLAYS, () => this.showTitle());
      if (d.enabled && d.menu === 'settings') this.ui.showSettings(this.save.settings, () => this.showTitle());
      if (d.enabled && d.menu === 'howto') this.ui.showHowTo(() => this.showTitle());
      if (d.enabled && d.menu === 'watch') {
        const bot = BOT_REPLAYS[runKey(d.map ?? 'tower', 'newage')];
        if (bot) this.watch(bot, 'Bot', () => this.showTitle());
      }
    }
    requestAnimationFrame(t => this.frame(t));
  }

  // ------------------------------------------------------------ flow

  private hasReplays(): boolean {
    return Object.keys(BOT_REPLAYS).length > 0 || Object.values(this.save.replays).some(r => r?.best || r?.last);
  }

  private showTitle(): void {
    const map = this.save.last?.map ?? 'tower';
    if (this.attract.mapId !== map) {
      this.attract = Sim.create('original', 12345, map);
      this.attractPrev = snapshot(this.attract);
    }
    this.phase = 'title';
    this.player = null;
    this.ui.hideReplayBar();
    this.canvas.classList.remove('playing');
    this.renderer.resetView();
    this.ui.showTitle(this.save, this.hasReplays());
  }

  private play(map: MapId, mode: Mode, fresh: boolean): void {
    const key = runKey(map, mode);
    const saved = fresh ? undefined : this.save.runs[key];
    if (saved) {
      this.sim = new Sim(structuredClone(saved.state));
      this.recorded = saved.inputs ? saved.inputs.slice() : null;
    } else {
      this.sim = Sim.create(mode, randomSeed(), map);
      this.recorded = [];
    }
    this.prev = snapshot(this.sim);
    this.save.last = { map, mode };
    if (fresh) delete this.save.runs[key];
    this.player = null;
    this.ui.hideReplayBar();
    this.acc = 0;
    this.inputs = [];
    this.pointerDown = false;
    this.winTimer = -1;
    this.phase = 'playing';
    this.persist();
    this.canvas.classList.add('playing');
    this.renderer.resetView();
    this.ui.hide();
    if (!saved) this.renderer.message(getMap(map).name.toUpperCase(), modeName(mode).toUpperCase(), 2.4, mode === 'original' ? '#ff8a8d' : '#9ff3ff');
  }

  private pause(): void {
    if (this.phase !== 'playing') return;
    this.releasePointer();
    this.phase = 'paused';
    this.canvas.classList.remove('playing');
    this.persist();
    this.ui.showPause(this.sim.mapId, this.sim.mode, this.save);
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
    const { mapId: map, mode } = this.sim;
    const key = runKey(map, mode);
    const stats = this.sim.state.stats;
    const prevBest = this.save.best[key];
    const isNewBest = !prevBest || stats.ticks < prevBest.ticks;
    if (isNewBest) this.save.best[key] = { ticks: stats.ticks, falls: stats.falls, date: new Date().toISOString() };
    this.save.wins[key] = (this.save.wins[key] ?? 0) + 1;
    delete this.save.runs[key];
    let replay: Replay | null = null;
    if (this.recorded) {
      replay = { v: 1, map, mode, seed: this.sim.state.seed, inputs: this.recorded, ticks: stats.ticks, won: true, by: 'player', date: new Date().toISOString(), stats: { ...stats }, physics: PHYSICS_VERSION, mapHash: mapHash(this.sim.map) };
      const slot = (this.save.replays[key] ??= {});
      slot.last = replay;
      if (isNewBest || !slot.best) slot.best = replay;
    }
    writeSave(this.save);
    this.phase = 'won';
    this.canvas.classList.remove('playing');
    this.winTimer = 1.6;
    this.winInfo = { isNewBest, prevBest, replay };
  }

  private showWinScreen(): void {
    const { mapId: map, mode } = this.sim;
    const replay = this.winInfo.replay;
    this.ui.showWin(
      map,
      mode,
      this.sim.state.stats,
      this.winInfo.prevBest,
      this.winInfo.isNewBest,
      replay ? () => this.watch(replay, `Your run · ${getMap(map).name}, ${modeName(mode)}`, () => this.showTitle()) : null,
      () => this.play(map, mode, true),
      () => this.showTitle(),
    );
  }

  private persist(): void {
    if ((this.phase === 'playing' || this.phase === 'paused') && !this.sim.state.won) {
      this.save.runs[runKey(this.sim.mapId, this.sim.mode)] = { state: this.sim.state, inputs: this.recorded };
    }
    writeSave(this.save);
  }

  private applySettings(s: Settings): void {
    this.save.settings = s;
    this.audio.setVolumes(s.music, s.sfx);
    this.renderer.setZoom(ZOOM[s.zoom]);
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

  // ------------------------------------------------------------ replays

  private watch(replay: Replay, title: string, back: () => void): void {
    this.player = new ReplayPlayer(replay, replay.by === 'bot' ? 2 : 4);
    this.replayBack = back;
    this.replayEnded = false;
    this.phase = 'replay';
    this.canvas.classList.remove('playing');
    this.renderer.resetView();
    this.ui.hide();
    this.ui.showReplayBar(title, {
      togglePause: () => this.toggleReplayPause(),
      setSpeed: sp => {
        if (this.player) this.player.speed = sp;
      },
      seek: f => this.seekReplay(f * (this.player?.end ?? 0)),
      exit: () => this.exitReplay(),
    });
  }

  private toggleReplayPause(): void {
    const p = this.player;
    if (!p) return;
    if (p.done) {
      this.restartReplay();
      return;
    }
    p.paused = !p.paused;
  }

  private seekReplay(tick: number): void {
    if (!this.player) return;
    this.player.seek(tick);
    this.renderer.resetView();
    if (this.replayEnded && !this.player.done) {
      this.replayEnded = false;
      this.ui.hide();
    }
  }

  private restartReplay(): void {
    if (!this.player) return;
    this.player.restart();
    this.renderer.resetView();
    this.replayEnded = false;
    this.ui.hide();
  }

  private exitReplay(): void {
    this.player = null;
    this.ui.hideReplayBar();
    this.phase = 'title';
    this.renderer.resetView();
    this.replayBack();
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
      if (this.phase === 'replay' && !this.ui.open) {
        this.toggleReplayPause();
        return;
      }
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
      if (this.phase === 'replay') {
        this.replayKey(e);
        return;
      }
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
      else if (this.debug.enabled && /^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1;
        const ev = this.sim.teleport(index);
        if (ev.length) this.recorded?.push({ tick: this.sim.state.stats.ticks, kind: 'teleport', x: index, y: 0 });
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

  private replayKey(e: KeyboardEvent): void {
    const p = this.player;
    if (!p || this.ui.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.exitReplay();
    } else if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      this.toggleReplayPause();
    } else if (e.key === 'ArrowRight') this.seekReplay(p.tick + 600);
    else if (e.key === 'ArrowLeft') this.seekReplay(p.tick - 600);
    else if (e.key === '+' || e.key === '=' || e.key === ']') p.speed = SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(p.speed as (typeof SPEEDS)[number]) + 1)];
    else if (e.key === '-' || e.key === '[') p.speed = SPEEDS[Math.max(0, SPEEDS.indexOf(p.speed as (typeof SPEEDS)[number]) - 1)];
  }

  /** CSS point straight above the dude, for Space when the mouse hasn't moved yet. */
  private defaultAimPoint(): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.width / 2, y: r.height * 0.2 };
  }

  private press(p: { x: number; y: number }): void {
    const w = this.renderer.screenToWorld(p.x, p.y);
    this.inputs.push({ kind: 'press', x: quantize(w.x), y: quantize(w.y) });
    this.pointerDown = true;
  }

  private release(): void {
    const p = this.pointer ?? this.defaultAimPoint();
    const w = this.renderer.screenToWorld(p.x, p.y);
    this.inputs.push({ kind: 'release', x: quantize(w.x), y: quantize(w.y) });
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
    this.renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  }

  private tick(): void {
    this.prev = snapshot(this.sim);
    const inputs = this.inputs.splice(0);
    if (this.recorded) {
      const tick = this.sim.state.stats.ticks;
      for (const i of inputs) this.recorded.push({ tick, kind: i.kind, x: i.x, y: i.y });
      if (this.recorded.length > MAX_RECORDED) this.recorded = null;
    }
    const events = this.sim.step(inputs);
    this.handleEvents(events);
  }

  private handleEvents(events: SimEvent[]): void {
    if (!events.length) return;
    this.renderer.onEvents(events, this.sim);
    this.audio.onEvents(events);
    for (const e of events) if (e.type === 'win') this.onWin();
  }

  /** Nothing much moves on screen: a pause menu, a finished or paused replay, the win screen. */
  private idle(): boolean {
    if (this.phase === 'paused') return true;
    if (this.phase === 'won') return this.winTimer <= 0;
    if (this.phase === 'replay') return !this.player || this.player.paused || this.player.done;
    return false;
  }

  private frame(now: number): void {
    // While idle, redraw at about 20 fps instead of the display's full rate: the screen is
    // nearly still, and a full-screen redraw every frame keeps the GPU (and fans) busy.
    if (this.idle() && now - this.last < 1000 / 20) {
      requestAnimationFrame(t => this.frame(t));
      return;
    }
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
      if (this.winTimer <= 0) this.showWinScreen();
    } else if (this.phase === 'replay' && this.player) {
      const p = this.player;
      const quiet = p.speed > 2;
      p.update(dt, (events, inputs) => {
        for (const i of inputs) if (i.kind === 'press') this.renderer.click(i.x, i.y);
        if (events.length) {
          this.renderer.onEvents(events, p.sim);
          if (!quiet) this.audio.onEvents(events);
        }
      });
      sim = p.sim;
      prev = p.prev;
      alpha = p.alpha;
      this.ui.updateReplayBar(p.tick, p.end, p.speed, p.paused, p.done);
      if (p.done && !this.replayEnded) {
        this.replayEnded = true;
        this.ui.showReplayEnd(p.sim.state.won, () => this.restartReplay(), () => this.exitReplay());
      }
    }

    const map = getMap(sim.mapId);
    const height = heightOf(map, sim.state.dude.y);
    this.audio.setIntensity(this.phase === 'title' ? 0.2 : height / (map.world.h * 0.7));
    this.audio.update(sim, this.phase === 'playing' || (this.phase === 'replay' && !!this.player && this.player.speed <= 2 && !this.player.paused && !this.player.done));

    const s = this.save.settings;
    this.renderer.render({
      sim,
      prev,
      alpha,
      t: this.time,
      dt,
      pointer: this.pointer,
      aimGuide: s.aimGuide,
      cursor: s.cursor,
      showTimer: s.showTimer,
      shake: s.shake && this.phase !== 'replay',
      hud: this.phase === 'playing' || this.phase === 'paused' || this.phase === 'replay',
      interactive: this.phase === 'playing',
      debug: this.debug.enabled && this.phase !== 'replay',
      replay: this.phase === 'replay' && this.player ? { speed: this.player.speed, paused: this.player.paused } : null,
    });
    requestAnimationFrame(t => this.frame(t));
  }

  /** Test hooks (only exposed in debug mode). */
  debugApi() {
    return {
      state: () => this.sim.state,
      phase: () => this.phase,
      save: () => this.save,
      play: (map: MapId, mode: Mode, fresh = true) => this.play(map, mode, fresh),
      input: (ev: InputEvent) => this.inputs.push(ev),
      maps: () => Object.keys(MAPS),
      replayTick: () => this.player?.tick ?? -1,
      /**
       * Start a run with the route's seed and feed its inputs through the real input path
       * (recording included), fast-forwarding to the end. Returns whether it won.
       */
      runRoute: (route: { map?: MapId; mode: Mode; seed: number; inputs: RecordedInput[] }) => {
        this.play(route.map ?? 'tower', route.mode, true);
        this.sim = Sim.create(route.mode, route.seed, route.map ?? 'tower');
        this.recorded = [];
        this.prev = snapshot(this.sim);
        const byTick = new Map<number, RecordedInput[]>();
        for (const i of route.inputs) byTick.set(i.tick, [...(byTick.get(i.tick) ?? []), i]);
        const last = Math.max(0, ...route.inputs.map(i => i.tick)) + 600;
        while (!this.sim.state.won && this.sim.state.stats.ticks < last) {
          for (const i of byTick.get(this.sim.state.stats.ticks) ?? []) {
            if (i.kind === 'teleport') {
              this.sim.teleport(i.x);
              this.recorded?.push(i);
            } else this.inputs.push({ kind: i.kind, x: i.x, y: i.y });
          }
          this.tick();
        }
        return this.sim.state.won;
      },
    };
  }
}
