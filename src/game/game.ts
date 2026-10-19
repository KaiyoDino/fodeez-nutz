// The game shell: fixed 60 Hz simulation, rendering, input, menus, saving, replays.

import { Audio } from '../audio/audio';
import { createEditor, type EditorHandle } from '../editor/editor';
import { formatTime, Renderer, snapshot, type Snapshot } from '../render/renderer';
import { wheelStyle, WHEELS } from '../render/wheels';
import { checkDoc, isCommunityMapId } from '../sim/custom-map';
import { getMap, heightOf, isBuiltinMap, MAPS, type MapId } from '../sim/level';
import { isReplay, mapHash, PHYSICS_VERSION, quantize, replayIsCurrent, type RecordedInput, type Replay } from '../sim/replay';
import { randomSeed } from '../sim/rng';
import { Sim } from '../sim/sim';
import type { InputEvent, Mode, SimEvent } from '../sim/types';
import { TICK_RATE } from '../sim/types';
import { checkAchievements, unlockedWheels, type Achievement } from './achievements';
import { matches, typing } from './keybind';
import { Online, type SubmitResult } from './online';
import { ReplayPlayer, SPEEDS } from './replay-player';
import { loadSave, runKey, writeSave, ZOOM, type Best, type RunKey, type SaveData, type Settings } from './save';
import { modeName, UI } from './ui';
import { UserMaps } from './user-maps';

const TICK = 1 / TICK_RATE;
type Phase = 'title' | 'playing' | 'paused' | 'won' | 'replay' | 'editor';
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
  private winInfo: { isNewBest: boolean; prevBest: Best | undefined; replay: Replay | null; unlocked: Achievement[]; posting: Promise<SubmitResult> | null } = {
    isNewBest: false,
    prevBest: undefined,
    replay: null,
    unlocked: [],
    posting: null,
  };
  private online: Online;
  /** The player's own maps and the community maps kept here. */
  private maps: UserMaps;
  /** The map maker, while it's open. */
  private editor: EditorHandle | null = null;
  /** Where quitting the current run goes (the map maker, a community map's page), if not the title. */
  private runBack: (() => void) | null = null;
  /** Set during a practice run from the map maker: where it started. It doesn't count for anything. */
  private practiceAt: { x: number; y: number } | null = null;
  private debug: DebugOptions;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, debug: DebugOptions) {
    this.canvas = canvas;
    this.debug = debug;
    this.renderer = new Renderer(canvas);
    // player maps first, so runs on them can be read from the save
    this.maps = new UserMaps();
    this.save = loadSave();
    // wins from before achievements existed count; no fanfare for those
    if (checkAchievements(this.save).length) writeSave(this.save);
    if (!unlockedWheels(this.save).includes(this.save.wheels)) this.save.wheels = 'standard';
    this.online = new Online(this.save.online, s => {
      this.save.online = s;
      writeSave(this.save);
    });
    this.audio.setVolumes(this.save.settings.music, this.save.settings.sfx);
    this.audio.prime();
    this.audio.playMusic(true);
    this.sim = Sim.create('original', 1);
    this.prev = snapshot(this.sim);
    this.attract = Sim.create('original', 12345, this.attractMap());
    this.attractPrev = snapshot(this.attract);
    this.ui = new UI(uiRoot, {
      play: (map, mode, fresh) => this.play(map, mode, fresh),
      resume: () => this.resume(),
      restart: () => this.restart(),
      quitToTitle: () => this.quitToTitle(),
      settingsChanged: s => this.applySettings(s),
      toggleFullscreen: () => this.toggleFullscreen(),
      watch: (replay, title, back) => this.watch(replay, title, back),
      openReplays: back => this.ui.showReplays(this.save, BOT_REPLAYS, back),
      sound: k => this.audio.ui(k),
      online: this.online,
      signedIn: () => this.postSavedBests(),
      setWheels: id => {
        this.save.wheels = id;
        writeSave(this.save);
      },
      maps: this.maps,
      openEditor: id => this.openEditor(id),
      playMap: (id, mode, fresh, back) => this.play(id, mode, fresh, { back }),
      draftInfo: id => this.draftInfo(id),
      uploadDraft: id => this.uploadDraft(id),
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
      if (d.enabled && d.menu === 'achievements') this.ui.showAchievements(this.save, () => this.showTitle());
      if (d.enabled && d.menu === 'leaderboards') this.ui.showLeaderboards(this.save, d.map ?? 'tower', d.mode ?? 'newage', () => this.showTitle());
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

  /** The title screen's attract demo runs on the last built-in map played. */
  private attractMap(): MapId {
    const m = this.save.last?.map;
    return m && isBuiltinMap(m) ? m : 'tower';
  }

  private showTitle(): void {
    const map = this.attractMap();
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

  /**
   * Start or continue a run. `back` is where quitting it goes (default: the title).
   * `practiceAt` starts a practice run from that point (map maker only): nothing about it is saved.
   */
  private play(map: MapId, mode: Mode, fresh: boolean, opts: { back?: () => void; practiceAt?: { x: number; y: number } } = {}): void {
    const key = runKey(map, mode);
    this.runBack = opts.back ?? null;
    this.practiceAt = opts.practiceAt ?? null;
    const saved = fresh || this.practiceAt ? undefined : this.save.runs[key];
    if (saved) {
      this.sim = new Sim(structuredClone(saved.state));
      this.recorded = saved.inputs ? saved.inputs.slice() : null;
    } else {
      this.sim = Sim.create(mode, randomSeed(), map);
      this.recorded = [];
    }
    if (this.practiceAt) {
      const at = this.practiceAt;
      const s = this.sim.state;
      s.dude.x = at.x;
      s.dude.y = at.y;
      s.airPeakY = at.y;
      if (s.original) {
        s.original.hookX = at.x + 14;
        s.original.hookY = at.y - 20;
      }
      this.recorded = null; // a run from partway up can't be replayed
    } else {
      this.save.last = { map, mode };
      if (fresh) delete this.save.runs[key];
    }
    this.prev = snapshot(this.sim);
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

  /** Start the current run over from the beginning (a practice run: from where it started). */
  private restart(): void {
    this.play(this.sim.mapId, this.sim.mode, true, { back: this.runBack ?? undefined, practiceAt: this.practiceAt ?? undefined });
  }

  private pause(): void {
    if (this.phase !== 'playing') return;
    this.releasePointer();
    this.phase = 'paused';
    this.canvas.classList.remove('playing');
    this.persist();
    this.ui.showPause(this.sim.mapId, this.sim.mode, this.save, this.quitLabel());
  }

  /** What quitting the current run is called. */
  private quitLabel(): string {
    const id = this.sim.mapId;
    if (this.runBack && this.maps.draft(id)) return 'Back to the map maker';
    if (this.runBack && isCommunityMapId(id)) return 'Back to the map';
    return 'Quit to title';
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
    const back = this.runBack;
    this.runBack = null;
    this.practiceAt = null;
    if (!back) return this.showTitle();
    this.phase = 'title';
    this.canvas.classList.remove('playing');
    this.renderer.resetView();
    back();
  }

  private onWin(): void {
    if (this.phase === 'won') return;
    if (this.practiceAt) {
      // a practice run: nothing is saved, it just says well done
      this.phase = 'won';
      this.canvas.classList.remove('playing');
      this.winTimer = 1.2;
      return;
    }
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
      replay = { v: 1, map, mode, seed: this.sim.state.seed, inputs: this.recorded, ticks: stats.ticks, won: true, by: 'player', date: new Date().toISOString(), stats: { ...stats }, physics: PHYSICS_VERSION, mapHash: mapHash(this.sim.map), wheels: this.save.wheels };
      const slot = (this.save.replays[key] ??= {});
      slot.last = replay;
      if (isNewBest || !slot.best) slot.best = replay;
    }
    const unlocked = checkAchievements(this.save);
    writeSave(this.save);
    this.phase = 'won';
    this.canvas.classList.remove('playing');
    this.winTimer = 1.6;
    // post it straight away (built-in and community maps); the win screen shows how it went
    const posting = replay && this.online.session && this.postable(map) ? this.online.submit(replay) : null;
    this.winInfo = { isNewBest, prevBest, replay, unlocked, posting };
  }

  /** Maps with leaderboards: the built-in ones and community maps (not drafts). */
  private postable(map: MapId): boolean {
    return isBuiltinMap(map) || isCommunityMapId(map);
  }

  /** The win screen's leaderboard line. */
  private showWinStatus(): void {
    if (!this.online.enabled) return;
    const { replay, posting } = this.winInfo;
    if (this.maps.draft(this.sim.mapId)) {
      this.ui.winUpload(this.sim.mapId, () => this.showWinScreen());
      return;
    }
    if (!replay) {
      this.ui.setWinStatus('This run wasn’t recorded, so it can’t go on the leaderboard.');
      return;
    }
    if (this.online.session && !posting) {
      // signed in from the win screen
      this.winInfo.posting = this.online.submit(replay);
      this.showWinStatus();
      return;
    }
    if (!this.online.session || !posting) {
      this.ui.setWinStatus('Sign in to put this time on the leaderboard.', {
        label: 'Sign in with itch.io',
        run: () => this.ui.showSignIn(() => this.showWinScreen(), () => this.showWinScreen()),
      });
      return;
    }
    this.ui.setWinStatus('Posting your time…');
    posting.then(r => {
      if (this.phase !== 'won') return;
      if (!r.ok) this.ui.setWinStatus(r.message);
      else if (r.improved && r.rank === 1) this.ui.setWinStatus('#1 on the leaderboard!');
      else if (r.improved && r.rank) this.ui.setWinStatus(`Posted! You’re #${r.rank} on the leaderboard.`);
      else if (r.rank && r.ticks === replay.ticks) this.ui.setWinStatus(`You’re #${r.rank} on the leaderboard.`);
      else if (r.rank) this.ui.setWinStatus(`Your leaderboard time (${formatTime(r.ticks ?? 0)}, #${r.rank}) is still faster.`);
      else this.ui.setWinStatus(`Not in the top 100 yet${r.cutoff ? ` (100th is ${formatTime(r.cutoff)})` : ''}.`);
    });
  }

  /** After signing in: post your saved best run on each level (the server ignores ones that aren't better). */
  private async postSavedBests(): Promise<void> {
    for (const key of Object.keys(this.save.replays) as RunKey[]) {
      const best = this.save.replays[key]?.best;
      if (!best || !this.online.session || !this.postable(best.map)) continue;
      const r = await this.online.submit(best);
      if (r.ok && r.improved && r.rank) this.ui.toast(`Posted your best on ${getMap(best.map).name} · ${modeName(best.mode)}`, `#${r.rank} with ${formatTime(best.ticks)}`);
    }
  }

  private announce(list: Achievement[]): void {
    for (const a of list) {
      this.ui.toast(`★ ${a.name}`, a.wheels ? `New wheels: ${WHEELS[a.wheels].name}` : a.desc);
      this.audio.ui('select');
    }
  }

  private showWinScreen(): void {
    const { mapId: map, mode } = this.sim;
    const back = this.runBack;
    const opts = { back: back ?? undefined };
    if (this.practiceAt) {
      const at = this.practiceAt;
      this.ui.showPracticeWin(
        () => this.play(map, mode, true, { ...opts, practiceAt: at }),
        () => this.quitToTitle(),
      );
      return;
    }
    const replay = this.winInfo.replay;
    const again = () => this.showWinScreen();
    const extra: HTMLElement[] = [];
    // rate a community map you just beat (not your own)
    const creator = isCommunityMapId(map) ? this.maps.creatorOf(map) : null;
    if (creator && this.online.enabled && creator !== this.online.session?.user.id) extra.push(this.ui.ratingPicker(map, null, () => undefined, again));
    this.ui.showWin(
      map,
      mode,
      this.sim.state.stats,
      this.winInfo.prevBest,
      this.winInfo.isNewBest,
      replay ? () => this.watch(replay, `Your run · ${getMap(map).name}, ${modeName(mode)}`, again) : null,
      () => this.play(map, mode, true, opts),
      () => (back ? this.quitToTitle() : this.showTitle()),
      this.winInfo.unlocked.map(a => (a.wheels ? `${a.name} · new wheels: ${WHEELS[a.wheels].name}` : a.name)),
      { backLabel: back ? this.quitLabel() : 'Title', extra },
    );
    this.showWinStatus();
  }

  // ------------------------------------------------------------ the map maker

  private openEditor(id: string): void {
    const d = this.maps.draft(id);
    if (!d) return;
    this.closeEditor();
    this.phase = 'editor';
    this.player = null;
    this.ui.hide();
    this.ui.hideReplayBar();
    this.canvas.classList.remove('playing');
    const myMaps = () => {
      this.phase = 'title';
      this.ui.showMyMaps(this.save, () => this.ui.showMaps(this.save));
    };
    this.editor = createEditor(document.body, {
      kind: 'draft',
      id,
      doc: structuredClone(d.doc),
      save: doc => {
        this.maps.updateDraft(id, doc);
        // a run in progress was on the old layout
        delete this.save.runs[runKey(id, 'original')];
        delete this.save.runs[runKey(id, 'newage')];
        writeSave(this.save);
      },
      play: (doc, at) => {
        this.closeEditor();
        this.play(id, doc.mode, true, { back: () => this.openEditor(id), practiceAt: at ?? undefined });
      },
      close: () => {
        this.closeEditor();
        myMaps();
      },
      status: () => this.draftInfo(id).status,
      restartKey: () => this.save.settings.restartKey,
    });
  }

  private closeEditor(): void {
    this.editor?.destroy();
    this.editor = null;
  }

  /** A draft's winning run on its current layout (what an upload needs), and a line about where it stands. */
  private draftInfo(id: string): { run: Replay | null; canUpload: boolean; status: string } {
    const d = this.maps.draft(id);
    if (!d) return { run: null, canUpload: false, status: '' };
    const problem = checkDoc(d.doc);
    if (problem) return { run: null, canUpload: false, status: problem };
    const best = this.save.replays[runKey(id, d.doc.mode)]?.best;
    const run = best && best.won && best.mode === d.doc.mode && replayIsCurrent(best) ? best : null;
    const sameAsUploaded = !!d.uploaded && d.uploaded.hash === mapHash(getMap(id)) && d.uploaded.mode === d.doc.mode;
    if (sameAsUploaded) return { run, canUpload: false, status: 'On the community maps.' };
    if (d.uploaded) return run ? { run, canUpload: true, status: `Changed since you uploaded it. Beaten in ${formatTime(run.ticks)}, so you can upload the new version.` } : { run, canUpload: false, status: 'Changed since you uploaded it. Beat it from the start to upload the new version.' };
    if (run) return { run, canUpload: true, status: `Beaten in ${formatTime(run.ticks)}. Ready to upload.` };
    return { run: null, canUpload: false, status: 'Not beaten yet. Beat it with Play from the start, and then you can upload it.' };
  }

  private async uploadDraft(id: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    const d = this.maps.draft(id);
    const info = this.draftInfo(id);
    if (!d || !info.run) return { ok: false, message: 'Beat your map from the start first.' };
    const r = await this.online.uploadMap(d.doc, info.run);
    if (!r.ok) return { ok: false, message: r.message };
    this.maps.markUploaded(id, r.map.id, mapHash(getMap(id)), d.doc.mode);
    this.maps.keepCommunity(r.map.id, d.doc, r.map.creator);
    return { ok: true, id: r.map.id };
  }

  private persist(): void {
    if ((this.phase === 'playing' || this.phase === 'paused') && !this.sim.state.won && !this.practiceAt) {
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
      if (this.ui.capturingKey) return;
      if (matches(this.save.settings.restartKey, e) && !typing(e) && (this.phase === 'playing' || this.phase === 'paused' || this.phase === 'won')) {
        // the restart key: no question asked (the map maker handles it itself)
        e.preventDefault();
        if (e.repeat) return;
        this.releasePointer();
        this.audio.ui('select');
        this.restart();
        return;
      }
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
    for (const e of events) {
      if (e.type === 'fall' && !this.practiceAt) {
        const m = e.distance / this.sim.map.metersPer;
        this.save.progress.fallen += m;
        this.save.progress.biggestFall = Math.max(this.save.progress.biggestFall, m);
        this.announce(checkAchievements(this.save));
      }
      if (e.type === 'win') this.onWin();
    }
  }

  /** Nothing much moves on screen: a pause menu, a finished or paused replay, the win screen. */
  private idle(): boolean {
    if (this.phase === 'paused') return true;
    if (this.phase === 'won') return this.winTimer <= 0;
    if (this.phase === 'replay') return !this.player || this.player.paused || this.player.done;
    return false;
  }

  private frame(now: number): void {
    // the map maker covers the game and draws itself
    if (this.phase === 'editor') {
      this.last = now;
      requestAnimationFrame(t => this.frame(t));
      return;
    }
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
      wheels: this.phase === 'replay' && this.player ? wheelStyle(this.player.replay.wheels) : WHEELS[this.save.wheels],
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
      /** The player's drafts (with their upload, if any). */
      drafts: () => this.maps.drafts.map(d => ({ id: d.id, name: d.doc.name, uploaded: d.uploaded?.id ?? null })),
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
