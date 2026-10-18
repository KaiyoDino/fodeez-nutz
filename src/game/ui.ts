// Menus are plain HTML on top of the canvas (real buttons, so keyboard and screen readers work).

import { buildDude } from '../render/dude';
import { bigText } from '../render/font';
import { P } from '../render/palette';
import { formatTime } from '../render/renderer';
import { WHEEL_IDS, WHEELS, type WheelId } from '../render/wheels';
import { getMap, heightOf, MAP_IDS, type MapId } from '../sim/level';
import { replayIsCurrent, type Replay } from '../sim/replay';
import type { Mode, Stats } from '../sim/types';
import { ACHIEVEMENTS, unlockedWheels, unlockFor } from './achievements';
import { localVersion, type Board, type Online } from './online';
import { SPEEDS } from './replay-player';
import { runKey, type Best, type SavedRun, type SaveData, type Settings } from './save';

export interface UIHandlers {
  play(map: MapId, mode: Mode, fresh: boolean): void;
  resume(): void;
  restart(): void;
  quitToTitle(): void;
  settingsChanged(s: Settings): void;
  toggleFullscreen(): void;
  watch(replay: Replay, title: string, back: () => void): void;
  openReplays(back: () => void): void;
  sound(kind: 'move' | 'select' | 'back'): void;
  /** The leaderboard connection. */
  online: Online;
  /** Called once a sign-in finishes (the game then posts your saved best times). */
  signedIn(): void;
  setWheels(id: WheelId): void;
}

export interface ReplayBarHandlers {
  togglePause(): void;
  setSpeed(speed: number): void;
  seek(fraction: number): void;
  exit(): void;
}

const MODE_INFO: Record<Mode, { name: string; blurb: string }> = {
  original: {
    name: 'Original',
    blurb: 'The 2023 physics, exactly. Hooking reverses gravity and yanks you up. Springs have no limit. Goop holds you tight, and if you stay stuck too long it sends you back to the start.',
  },
  newage: {
    name: 'New Age',
    blurb: 'Rebuilt physics. Hold and the rope reels you in, faster the longer you hold, then flings you on past the plunger. Fire in any direction. Goop lets you slide off slowly before it drops you.',
  },
};

export const modeName = (m: Mode) => MODE_INFO[m].name;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

let logoUrl: string | null = null;
function logo(): HTMLImageElement {
  if (!logoUrl) {
    const a = bigText('FODEEZ', 4, P.g3, P.g4, P.g1, P.ink, 'rgba(13,11,32,0.6)');
    const b = bigText('NUTZ', 4, P.y1, P.y2, P.y0, P.ink, 'rgba(13,11,32,0.6)');
    const c = document.createElement('canvas');
    c.width = Math.max(a.width, b.width);
    c.height = a.height + b.height - 6;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(a, Math.round((c.width - a.width) / 2), 0);
    ctx.drawImage(b, Math.round((c.width - b.width) / 2), a.height - 6);
    logoUrl = c.toDataURL();
  }
  return el('img', { src: logoUrl, alt: 'Fodeez Nutz', className: 'logo' });
}

const MODES: Mode[] = ['original', 'newage'];

const wheelPics = new Map<WheelId, string>();
/** A picture of the dude wearing a set of wheels (for the wheel picker). */
function wheelPicture(id: WheelId): string {
  let url = wheelPics.get(id);
  if (!url) {
    url = buildDude({ facing: 1, wheel: 0.35, aim: null, loaded: true, stuck: false, t: 0, wheels: WHEELS[id] }).toDataURL();
    wheelPics.set(id, url);
  }
  return url;
}

function describeRun(run: SavedRun): string {
  const map = getMap(run.state.world.map);
  return `${formatTime(run.state.stats.ticks)} · ${Math.max(0, Math.round(heightOf(map, run.state.dude.y) / map.metersPer))} m`;
}

export class UI {
  private root: HTMLElement;
  private barRoot: HTMLElement;
  private toastRoot: HTMLElement;
  private h: UIHandlers;
  /** The line on the win screen that says how posting the time went. */
  private winStatus: HTMLElement | null = null;
  /** Stops polling for a sign-in when its screen closes. */
  private signInAbort: AbortController | null = null;
  private escape: (() => void) | null = null;
  private bar: { update(tick: number, end: number, speed: number, paused: boolean, done: boolean): void } | null = null;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.h = handlers;
    this.barRoot = el('div', { className: 'replay-bar-root' });
    this.toastRoot = el('div', { className: 'toasts', role: 'status' } as Partial<HTMLDivElement>);
    document.body.append(this.barRoot, this.toastRoot);
    window.addEventListener(
      'keydown',
      e => {
        if (e.key === 'Escape' && this.escape && this.root.childElementCount > 0) {
          e.preventDefault();
          e.stopPropagation();
          this.h.sound('back');
          this.escape();
        }
      },
      true,
    );
  }

  get open(): boolean {
    return this.root.childElementCount > 0;
  }

  hide(): void {
    this.root.replaceChildren();
    this.escape = null;
    this.winStatus = null;
  }

  private mount(panel: HTMLElement, opts: { escape?: () => void; dim?: boolean } = {}): void {
    this.winStatus = null;
    this.signInAbort?.abort();
    this.signInAbort = null;
    const screen = el('div', { className: 'screen' + (opts.dim === false ? '' : ' dim') }, [panel]);
    this.root.replaceChildren(screen);
    this.escape = opts.escape ?? null;
    const first = panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>('button');
    first?.focus({ preventScroll: true });
  }

  private button(label: string, onClick: () => void, opts: { kind?: 'primary' | 'quiet' | 'danger'; autofocus?: boolean; sound?: 'select' | 'back'; small?: boolean } = {}): HTMLButtonElement {
    const b = el('button', { type: 'button', className: `btn ${opts.kind ?? ''} ${opts.small ? 'small' : ''}`.trim(), textContent: label });
    if (opts.autofocus) b.dataset.autofocus = '';
    b.addEventListener('click', () => {
      this.h.sound(opts.sound ?? 'select');
      onClick();
    });
    b.addEventListener('mouseenter', () => this.h.sound('move'));
    return b;
  }

  /** A button that asks once before doing something you can't undo. */
  private confirmButton(label: string, question: string, onConfirm: () => void): HTMLElement {
    const wrap = el('div', { className: 'confirm' });
    const ask = () => {
      const yes = this.button('Yes', onConfirm, { kind: 'danger' });
      const no = this.button('No', () => wrap.replaceChildren(btn), { kind: 'quiet', sound: 'back' });
      wrap.replaceChildren(el('p', { textContent: question }), el('div', { className: 'row' }, [yes, no]));
      no.focus();
    };
    const btn = this.button(label, ask);
    wrap.append(btn);
    return wrap;
  }

  // ------------------------------------------------------------ title and run selection

  /**
   * "Click to start": browsers won't play sound until the page gets a click or key press,
   * so the first screen asks for one and the music starts with it.
   */
  showGate(onStart: () => void): void {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      this.gateClose = null;
      window.removeEventListener('keydown', onKey, true);
      onStart();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') return;
      e.preventDefault();
      go();
    };
    const start = el('button', { type: 'button', className: 'gate-start', textContent: 'Click to start' });
    const panel = el('div', { className: 'panel title gate' }, [logo(), start, el('p', { className: 'muted', textContent: 'or press any key' })]);
    this.mount(panel, { dim: false });
    panel.parentElement!.addEventListener('pointerdown', e => {
      e.preventDefault();
      go();
    });
    window.addEventListener('keydown', onKey, true);
    this.gateClose = () => {
      done = true;
      window.removeEventListener('keydown', onKey, true);
    };
  }

  get gateOpen(): boolean {
    return this.gateClose !== null;
  }

  /** Drops the start screen without starting (used when the browser allows sound anyway). */
  closeGate(): void {
    this.gateClose?.();
    this.gateClose = null;
  }

  private gateClose: (() => void) | null = null;

  showTitle(save: SaveData, hasReplays: boolean): void {
    const last = save.last;
    const run = last ? save.runs[runKey(last.map, last.mode)] : undefined;
    const buttons = el('div', { className: 'stack' });
    if (run && last) {
      buttons.append(this.button(`Continue · ${getMap(last.map).name}, ${modeName(last.mode)}`, () => this.h.play(last.map, last.mode, false), { kind: 'primary', autofocus: true }));
      buttons.append(this.button('Play', () => this.showMaps(save)));
    } else {
      buttons.append(this.button('Play', () => this.showMaps(save), { kind: 'primary', autofocus: true }));
    }
    const again = () => this.showTitle(save, hasReplays);
    if (this.h.online.enabled) buttons.append(this.button('Leaderboards', () => this.showLeaderboards(save, save.last?.map ?? 'tower', save.last?.mode ?? 'newage', again)));
    if (hasReplays) buttons.append(this.button('Replays', () => this.h.openReplays(again)));
    buttons.append(this.button('Achievements', () => this.showAchievements(save, again)));
    buttons.append(
      el('div', { className: 'row minor' }, [
        this.button('How to play', () => this.showHowTo(again), { small: true }),
        this.button('Settings', () => this.showSettings(save.settings, again), { small: true }),
        this.button('Credits', () => this.showCredits(again), { small: true }),
      ]),
    );
    const panel = el('div', { className: 'panel title' }, [
      logo(),
      el('p', { className: 'tagline', textContent: 'No checkpoints. One plunger. A long way up.' }),
      buttons,
      el('p', { className: 'rotate-hint', textContent: 'Tip: turn your phone sideways for a bigger view.' }),
    ]);
    this.mount(panel, { dim: false });
  }

  showMaps(save: SaveData, back?: () => void): void {
    const goBack = back ?? (() => this.h.quitToTitle());
    const cards = el('div', { className: 'modes' });
    for (const id of MAP_IDS) {
      const map = getMap(id);
      const bests = (['original', 'newage'] as const)
        .map(m => {
          const b = save.best[runKey(id, m)];
          return b ? `${modeName(m)} ${formatTime(b.ticks)}` : null;
        })
        .filter(Boolean)
        .join(' · ');
      const inProgress = (['original', 'newage'] as const).some(m => save.runs[runKey(id, m)]);
      const card = el('section', { className: `card map-${id}` }, [
        el('h2', { textContent: map.name }),
        el('p', { textContent: map.tagline }),
        el('p', { className: 'muted', textContent: `Built for ${modeName(map.designedFor)} physics. Both modes work.` }),
        el('p', { className: 'best', textContent: bests ? `Best: ${bests}` : inProgress ? 'Run in progress' : 'Not beaten yet' }),
        el('div', { className: 'stack' }, [this.button(`Climb ${map.name}`, () => this.showModes(save, id), { kind: 'primary', autofocus: id === (save.last?.map ?? 'tower') })]),
      ]);
      cards.append(card);
    }
    const panel = el('div', { className: 'panel wide' }, [el('h1', { textContent: 'Choose a map' }), cards, el('div', { className: 'row' }, [this.button('Back', goBack, { kind: 'quiet', sound: 'back' })])]);
    this.mount(panel, { escape: goBack });
  }

  showModes(save: SaveData, map: MapId): void {
    const cards = el('div', { className: 'modes' });
    const m = getMap(map);
    for (const mode of ['original', 'newage'] as const) {
      const info = MODE_INFO[mode];
      const key = runKey(map, mode);
      const run = save.runs[key];
      const best = save.best[key];
      const actions = el('div', { className: 'stack' });
      const focus = mode === (save.last?.map === map ? save.last.mode : m.designedFor);
      if (run) {
        actions.append(this.button(`Continue (${describeRun(run)})`, () => this.h.play(map, mode, false), { kind: 'primary', autofocus: focus }));
        actions.append(this.confirmButton('New run', 'Throw away your current run?', () => this.h.play(map, mode, true)));
      } else actions.append(this.button('New run', () => this.h.play(map, mode, true), { kind: 'primary', autofocus: focus }));
      const card = el('section', { className: `card ${mode}` }, [
        el('h2', { textContent: info.name + (m.designedFor === mode ? ' ★' : '') }),
        el('p', { textContent: info.blurb }),
        el('p', { className: 'best', textContent: best ? `Best: ${formatTime(best.ticks)} · ${best.falls} falls` : 'Not beaten yet' }),
        actions,
      ]);
      cards.append(card);
    }
    const panel = el('div', { className: 'panel wide' }, [
      el('h1', { textContent: m.name }),
      el('p', { className: 'muted', textContent: `★ The physics this map was built for.` }),
      cards,
      el('div', { className: 'row' }, [this.button('Back', () => this.showMaps(save), { kind: 'quiet', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: () => this.showMaps(save) });
  }

  // ------------------------------------------------------------ replays

  /** The list of replays you can watch: the bot's winning runs and your own wins. */
  showReplays(save: SaveData, bots: Partial<Record<string, Replay>>, back: () => void): void {
    const again = () => this.showReplays(save, bots, back);
    const groups = el('div', { className: 'replay-groups' });
    for (const id of MAP_IDS) {
      const map = getMap(id);
      const list = el('div', { className: 'replay-list' });
      for (const mode of ['original', 'newage'] as const) {
        const key = runKey(id, mode);
        const rows: [string, Replay][] = [];
        const bot = bots[key];
        if (bot) rows.push(['Bot', bot]);
        const mine = save.replays[key];
        if (mine?.best) rows.push(['Your best', mine.best]);
        if (mine?.last && mine.last !== mine.best && mine.last.ticks !== mine.best?.ticks) rows.push(['Your last win', mine.last]);
        for (const [who, r] of rows) {
          const title = `${who} · ${map.name}, ${modeName(mode)}`;
          const old = !replayIsCurrent(r);
          const what = el('span', { className: 'what', textContent: modeName(mode) });
          if (old) {
            what.append(el('span', { className: 'stale', textContent: ' · older version' }));
            what.title = 'Recorded before a change to the physics or this map, so it may not play out the same way.';
          }
          list.append(
            el('div', { className: 'replay-row' }, [
              el('span', { className: 'who', textContent: who }),
              what,
              el('span', { className: 'time', textContent: formatTime(r.ticks) }),
              this.button('Watch', () => this.h.watch(r, title, again), { small: true }),
            ]),
          );
        }
      }
      if (!list.childElementCount) list.append(el('p', { className: 'muted', textContent: 'No replays yet.' }));
      groups.append(el('section', { className: 'replay-group' }, [el('h2', { textContent: map.name }), list]));
    }
    const panel = el('div', { className: 'panel wide' }, [
      el('h1', { textContent: 'Replays' }),
      el('p', { className: 'muted', textContent: 'The bot’s runs prove each map can be beaten. Your own wins are saved here too.' }),
      groups,
      el('div', { className: 'row' }, [this.button('Back', back, { kind: 'quiet', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: back });
  }

  /** The control bar shown while a replay plays. */
  showReplayBar(title: string, handlers: ReplayBarHandlers): void {
    const play = el('button', { type: 'button', className: 'btn small', textContent: 'Pause' });
    play.addEventListener('click', () => handlers.togglePause());
    const speeds = el('div', { className: 'speeds', role: 'group' } as Partial<HTMLDivElement>);
    speeds.setAttribute('aria-label', 'Playback speed');
    const speedButtons = SPEEDS.map(sp => {
      const b = el('button', { type: 'button', className: 'btn small quiet', textContent: `${sp}×` });
      b.addEventListener('click', () => handlers.setSpeed(sp));
      speeds.append(b);
      return { sp, b };
    });
    const seek = el('input', { type: 'range', min: '0', max: '1000', step: '1', value: '0', id: 'replay-seek' });
    seek.setAttribute('aria-label', 'Replay position');
    let dragging = false;
    seek.addEventListener('pointerdown', () => (dragging = true));
    seek.addEventListener('pointerup', () => (dragging = false));
    seek.addEventListener('input', () => handlers.seek(Number(seek.value) / 1000));
    const time = el('span', { className: 'replay-time', textContent: '0:00.0' });
    const exit = el('button', { type: 'button', className: 'btn small primary', textContent: 'Exit' });
    exit.addEventListener('click', () => handlers.exit());
    const bar = el('div', { className: 'replay-bar' }, [el('span', { className: 'replay-title', textContent: title }), play, speeds, seek, time, exit]);
    this.barRoot.replaceChildren(bar);
    // only touch the DOM when something changed (this runs every frame)
    let last = '';
    this.bar = {
      update: (tick, end, speed, paused, done) => {
        const label = done ? 'Restart' : paused ? 'Play' : 'Pause';
        const pos = String(Math.round((tick / Math.max(1, end)) * 1000));
        const clock = `${formatTime(tick)} / ${formatTime(end)}`;
        const key = `${label}|${speed}|${pos}|${clock}|${dragging}`;
        if (key === last) return;
        last = key;
        if (play.textContent !== label) play.textContent = label;
        for (const { sp, b } of speedButtons) b.classList.toggle('active', sp === speed);
        if (!dragging && seek.value !== pos) seek.value = pos;
        if (time.textContent !== clock) time.textContent = clock;
      },
    };
  }

  updateReplayBar(tick: number, end: number, speed: number, paused: boolean, done: boolean): void {
    this.bar?.update(tick, end, speed, paused, done);
  }

  hideReplayBar(): void {
    this.barRoot.replaceChildren();
    this.bar = null;
  }

  showReplayEnd(won: boolean, onAgain: () => void, onBack: () => void): void {
    const panel = el('div', { className: 'panel' }, [
      el('h1', { textContent: won ? 'Replay over' : 'End of replay' }),
      el('div', { className: 'row' }, [this.button('Watch again', onAgain, { kind: 'primary', autofocus: true }), this.button('Back', onBack, { kind: 'quiet', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: onBack, dim: false });
  }

  // ------------------------------------------------------------ leaderboards

  /** Signed-in name and a sign-out button, or a sign-in button. */
  private account(again: () => void): HTMLElement {
    const online = this.h.online;
    const s = online.session;
    if (s) {
      return el('div', { className: 'account' }, [
        el('span', { className: 'muted', textContent: 'Signed in as' }),
        el('b', { textContent: s.user.name }),
        this.button(
          'Sign out',
          () => {
            online.signOut();
            again();
          },
          { kind: 'quiet', small: true, sound: 'back' },
        ),
      ]);
    }
    return el('div', { className: 'account' }, [
      el('span', { className: 'muted', textContent: 'Sign in to post your times.' }),
      this.button('Sign in with itch.io', () => this.showSignIn(again, again), { small: true, kind: 'primary' }),
    ]);
  }

  /** The top 100 for one level, with a level picker and the replays to watch. */
  showLeaderboards(save: SaveData, map: MapId, mode: Mode, back: () => void): void {
    const online = this.h.online;
    const again = () => this.showLeaderboards(save, map, mode, back);
    const picker = el('div', { className: 'choices level-picker', role: 'radiogroup' } as Partial<HTMLDivElement>);
    picker.setAttribute('aria-label', 'Level');
    for (const id of MAP_IDS)
      for (const m of MODES) {
        const b = this.button(`${getMap(id).name} · ${modeName(m)}`, () => this.showLeaderboards(save, id, m, back), { small: true, kind: 'quiet' });
        b.setAttribute('role', 'radio');
        const on = id === map && m === mode;
        b.setAttribute('aria-checked', String(on));
        b.classList.toggle('active', on);
        if (on) b.dataset.autofocus = '';
        picker.append(b);
      }
    const list = el('div', { className: 'board' }, [el('p', { className: 'muted', textContent: 'Loading…' })]);
    const footer = el('div', { className: 'board-footer' });
    const panel = el('div', { className: 'panel wide' }, [
      el('h1', { textContent: 'Leaderboards' }),
      this.account(again),
      picker,
      list,
      footer,
      el('div', { className: 'row' }, [this.button('Back', back, { kind: 'quiet', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: back });

    const key = runKey(map, mode);
    const title = `${getMap(map).name}, ${modeName(mode)}`;
    online.board(map, mode).then(
      (b: Board) => {
        if (!panel.isConnected) return;
        const current = b.version === localVersion(map);
        if (!current) list.replaceChildren(el('p', { className: 'muted', textContent: 'This copy of the game is out of date, so its runs can’t go on the board. Reload the page to update it.' }));
        else if (!b.entries.length) list.replaceChildren(el('p', { className: 'muted', textContent: 'Nobody has posted a time here yet. Be the first!' }));
        else {
          const rows = b.entries.map(e => {
            const mine = online.session?.user.id === e.user.id;
            const name = e.user.url ? el('a', { href: e.user.url, target: '_blank', rel: 'noopener', textContent: e.user.name }) : el('span', { textContent: e.user.name });
            const watch = this.button(
              'Watch',
              () => {
                watch.disabled = true;
                online.replay(map, mode, e.user.id).then(
                  r => this.h.watch(r, `#${e.rank} ${e.user.name} · ${title}`, again),
                  err => {
                    watch.disabled = false;
                    this.toast('Couldn’t load that replay', (err as Error).message);
                  },
                );
              },
              { small: true },
            );
            return el('div', { className: 'board-row' + (mine ? ' mine' : '') }, [
              el('span', { className: 'rank', textContent: `#${e.rank}` }),
              el('span', { className: 'who' }, [name]),
              el('span', { className: 'time', textContent: formatTime(e.ticks) }),
              watch,
            ]);
          });
          list.replaceChildren(...rows);
        }
        // your saved best, if it beats what the board has for you
        const mine = save.replays[key]?.best;
        const best = save.best[key];
        if (b.you) footer.append(el('p', { textContent: `You’re #${b.you.rank} here with ${formatTime(b.you.ticks)}.` }));
        if (current && online.session && mine && replayIsCurrent(mine) && (!b.you || mine.ticks < b.you.ticks)) {
          const label = `Post your best (${formatTime(mine.ticks)})`;
          const post = this.button(label, () => {
            post.disabled = true;
            post.textContent = 'Posting…';
            online.submit(mine).then(r => {
              if (!panel.isConnected) return;
              if (r.ok) {
                again();
                return;
              }
              this.toast('Couldn’t post that time', r.message);
              post.disabled = false;
              post.textContent = label;
            });
          });
          footer.append(post);
        } else if (best && !b.you) footer.append(el('p', { className: 'muted', textContent: `Your best here is ${formatTime(best.ticks)}${mine && !replayIsCurrent(mine) ? ', from an older version of the game' : ''}.` }));
      },
      err => {
        if (panel.isConnected) list.replaceChildren(el('p', { className: 'muted', textContent: (err as Error).message }));
      },
    );
  }

  /**
   * Sign in with itch.io. The sign-in page opens in a new tab (popups and redirects are unreliable
   * inside itch.io's frame) and this screen waits for it to finish. If the tab can't open, there's
   * a link to copy into a browser instead; it works from anywhere.
   */
  showSignIn(onDone: () => void, back: () => void): void {
    const online = this.h.online;
    const { url, lid } = online.signInUrl();
    let opened: Window | null = null;
    try {
      opened = window.open(url, '_blank');
    } catch {
      opened = null;
    }
    const link = el('a', { href: url, target: '_blank', rel: 'noopener', textContent: 'open the sign-in page' });
    const copy = this.button(
      'Copy link',
      () => {
        navigator.clipboard?.writeText(url).then(
          () => (copy.textContent = 'Copied'),
          () => (copy.textContent = 'Couldn’t copy'),
        );
      },
      { small: true, kind: 'quiet' },
    );
    const panel = el('div', { className: 'panel signin' }, [
      el('h1', { textContent: 'Sign in with itch.io' }),
      el('p', { textContent: opened ? 'A new tab opened on itch.io. Approve Fodeez Nutz there, then come back. This screen updates by itself.' : 'Open the sign-in page, approve Fodeez Nutz on itch.io, then come back. This screen updates by itself.' }),
      el('p', { className: 'muted' }, ['Nothing opened? You can ', link, ', or copy the link into any browser.']),
      el('p', { className: 'muted', textContent: 'The game only gets your itch.io name and profile link.' }),
      el('div', { className: 'row' }, [copy, this.button('Cancel', back, { kind: 'quiet', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: back });
    const abort = new AbortController();
    this.signInAbort = abort;
    online.waitForSignIn(lid, abort.signal).then(s => {
      if (abort.signal.aborted) return;
      this.signInAbort = null;
      if (!s) {
        this.toast('Sign-in timed out', 'Try again when you’re ready.');
        back();
        return;
      }
      this.toast('Signed in', `Welcome, ${s.user.name}!`);
      this.h.signedIn();
      onDone();
    });
  }

  // ------------------------------------------------------------ achievements and wheels

  showAchievements(save: SaveData, back: () => void): void {
    const again = () => this.showAchievements(save, back);
    const owned = new Set(unlockedWheels(save));
    const picker = el('div', { className: 'wheels', role: 'radiogroup' } as Partial<HTMLDivElement>);
    picker.setAttribute('aria-label', 'Wheels');
    for (const id of WHEEL_IDS) {
      const have = owned.has(id);
      const on = save.wheels === id;
      const how = unlockFor(id);
      const b = el('button', { type: 'button', className: 'wheel' + (on ? ' active' : '') + (have ? '' : ' locked'), disabled: !have }, [
        el('img', { src: wheelPicture(id), alt: '' }),
        el('span', { className: 'name', textContent: WHEELS[id].name }),
        el('span', { className: 'how', textContent: have ? (on ? 'On' : 'Put on') : `Earn ${how?.name ?? ''}` }),
      ]);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('aria-label', `${WHEELS[id].name} wheels${have ? '' : `, locked: earn ${how?.name ?? ''}`}`);
      if (have) {
        b.addEventListener('click', () => {
          this.h.sound('select');
          this.h.setWheels(id);
          again();
        });
        b.addEventListener('mouseenter', () => this.h.sound('move'));
      }
      if (on) b.dataset.autofocus = '';
      picker.append(b);
    }

    const groups = new Map<string, HTMLElement>();
    for (const a of ACHIEVEMENTS) {
      let list = groups.get(a.group);
      if (!list) groups.set(a.group, (list = el('div', { className: 'ach-list' })));
      const got = !!save.progress.unlocked[a.id];
      const p = got ? undefined : a.progress?.(save);
      const extra = [p ? `${Math.min(p.have, p.need).toLocaleString('en')} / ${p.need.toLocaleString('en')} ${p.unit}` : '', a.wheels ? `Unlocks ${WHEELS[a.wheels].name} wheels` : ''].filter(Boolean).join(' · ');
      const row = el('div', { className: 'ach' + (got ? ' got' : '') }, [
        el('span', { className: 'mark', textContent: got ? '★' : '☆' }),
        el('div', {}, [el('div', { className: 'ach-name', textContent: a.name }), el('div', { className: 'ach-desc', textContent: a.desc }), extra ? el('div', { className: 'ach-extra', textContent: extra }) : '']),
      ]);
      row.firstElementChild!.setAttribute('aria-label', got ? 'Earned' : 'Not earned yet');
      list.append(row);
    }
    const sections = el('div', { className: 'ach-groups' });
    for (const [name, list] of groups) sections.append(el('section', { className: 'ach-group' }, [el('h2', { textContent: name }), list]));
    const count = ACHIEVEMENTS.filter(a => save.progress.unlocked[a.id]).length;
    const panel = el('div', { className: 'panel wide' }, [
      el('h1', { textContent: 'Achievements' }),
      el('p', { className: 'muted', textContent: `${count} of ${ACHIEVEMENTS.length} earned. Beating a level unlocks a new set of wheels.` }),
      el('h2', { className: 'sub', textContent: 'Wheels' }),
      picker,
      sections,
      el('div', { className: 'row' }, [this.button('Back', back, { kind: 'quiet', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: back });
  }

  /** A note in the corner that goes away by itself. */
  toast(title: string, text?: string): void {
    const t = el('div', { className: 'toast' }, [el('div', { className: 'toast-title', textContent: title }), text ? el('div', { className: 'toast-text', textContent: text }) : '']);
    this.toastRoot.append(t);
    while (this.toastRoot.childElementCount > 4) this.toastRoot.firstElementChild!.remove();
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4700);
  }

  /** Update the leaderboard line on the win screen (if it's still showing). */
  setWinStatus(text: string, action?: { label: string; run: () => void }): void {
    const s = this.winStatus;
    if (!s) return;
    s.replaceChildren(el('span', { textContent: text }));
    if (action) s.append(this.button(action.label, action.run, { small: true }));
  }

  // ------------------------------------------------------------ in a run

  showPause(map: MapId, mode: Mode, save: SaveData): void {
    const panel = el('div', { className: 'panel' }, [
      el('h1', { textContent: 'Paused' }),
      el('p', { className: 'muted', textContent: `${getMap(map).name}, ${modeName(mode)} · your run is saved` }),
      el('div', { className: 'stack' }, [
        this.button('Resume', () => this.h.resume(), { kind: 'primary', autofocus: true }),
        this.button('Settings', () => this.showSettings(save.settings, () => this.showPause(map, mode, save))),
        this.button('How to play', () => this.showHowTo(() => this.showPause(map, mode, save))),
        this.confirmButton('Restart run', 'Start over from the bottom?', () => this.h.restart()),
        this.button('Quit to title', () => this.h.quitToTitle(), { kind: 'quiet', sound: 'back' }),
      ]),
    ]);
    this.mount(panel, { escape: () => this.h.resume() });
  }

  showSettings(settings: Settings, back: () => void): void {
    const s = { ...settings };
    const change = () => this.h.settingsChanged({ ...s });
    const slider = (id: string, label: string, key: 'music' | 'sfx') => {
      const input = el('input', { type: 'range', min: '0', max: '100', step: '5', id, value: String(Math.round(s[key] * 100)) });
      const out = el('output', { textContent: `${Math.round(s[key] * 100)}%` });
      out.htmlFor.add(id);
      input.addEventListener('input', () => {
        s[key] = Number(input.value) / 100;
        out.textContent = `${input.value}%`;
        change();
      });
      return el('div', { className: 'setting' }, [el('label', { htmlFor: id, textContent: label }), input, out]);
    };
    const toggle = (id: string, label: string, key: 'shake' | 'aimGuide' | 'showTimer') => {
      const input = el('input', { type: 'checkbox', id, checked: s[key] });
      input.addEventListener('change', () => {
        s[key] = input.checked;
        this.h.sound('move');
        change();
      });
      return el('div', { className: 'setting toggle' }, [el('label', { htmlFor: id, textContent: label }), input]);
    };
    const choice = <K extends 'cursor' | 'zoom'>(label: string, key: K, options: [Settings[K], string][]) => {
      const group = el('div', { className: 'choices', role: 'radiogroup' } as Partial<HTMLDivElement>);
      group.setAttribute('aria-label', label);
      const buttons = options.map(([value, text]) => {
        const b = el('button', { type: 'button', className: 'btn small quiet', textContent: text });
        b.setAttribute('role', 'radio');
        b.addEventListener('click', () => {
          s[key] = value;
          this.h.sound('move');
          sync();
          change();
        });
        group.append(b);
        return { value, b };
      });
      const sync = () => {
        for (const { value, b } of buttons) {
          b.classList.toggle('active', value === s[key]);
          b.setAttribute('aria-checked', String(value === s[key]));
        }
      };
      sync();
      return el('div', { className: 'setting choice' }, [el('span', { className: 'label', textContent: label }), group]);
    };
    const panel = el('div', { className: 'panel' }, [
      el('h1', { textContent: 'Settings' }),
      el('div', { className: 'settings' }, [
        slider('set-music', 'Music', 'music'),
        slider('set-sfx', 'Sound effects', 'sfx'),
        toggle('set-aim', 'Aim guide', 'aimGuide'),
        toggle('set-timer', 'Show timer', 'showTimer'),
        toggle('set-shake', 'Screen shake', 'shake'),
        choice('Crosshair', 'cursor', [
          ['small', 'Small'],
          ['medium', 'Medium'],
          ['large', 'Large'],
        ]),
        choice('Zoom', 'zoom', [
          ['far', 'Far'],
          ['normal', 'Normal'],
          ['close', 'Close'],
        ]),
      ]),
      el('div', { className: 'row' }, [this.button('Fullscreen', () => this.h.toggleFullscreen(), { kind: 'quiet' }), this.button('Done', back, { kind: 'primary', sound: 'back', autofocus: true })]),
    ]);
    this.mount(panel, { escape: back });
  }

  showHowTo(back: () => void): void {
    const panel = el('div', { className: 'panel wide howto' }, [
      el('h1', { textContent: 'How to play' }),
      el('ul', {}, [
        el('li', { textContent: 'He can’t stop rolling. Walls turn him around.' }),
        el('li', { textContent: 'Click or tap to fire his plunger. It only sticks to targets; anything else stops it.' }),
        el('li', { textContent: 'Hold to be pulled in, let go to fly. You get 3 shots per jump. Landing, springs or goop refill them.' }),
        el('li', { textContent: 'Red girders are solid. Springs bounce you. Purple goop grabs you from any side.' }),
        el('li', { textContent: 'There are no checkpoints. Your run is saved whenever you leave.' }),
        el('li', { textContent: 'Two maps: The Tower (the original, built for Original physics) and The Crane (built for New Age). Both modes work on both.' }),
        el('li', { textContent: 'Esc pauses. Space works like the mouse button.' }),
      ]),
      el('div', { className: 'modes compact' }, [
        el('section', { className: 'card original' }, [
          el('h2', { textContent: 'Original' }),
          el('p', { textContent: 'Fire only by clicking well above him. While hooked, gravity flips and pulls you up until you let go or pass the target. Letting go gives a little boost. Stuck in goop too long? Back to the start.' }),
        ]),
        el('section', { className: 'card newage' }, [
          el('h2', { textContent: 'New Age' }),
          el('p', { textContent: 'Fire in any direction. Hold and the rope reels you toward the plunger, faster the longer you hold. When you reach it, it lets go and you fly on the way it pulled you; let go early to keep the speed you have. Spring pads bounce you up and refill your shots. Goop lets you slide off slowly, then drops you.' }),
        ]),
      ]),
      el('div', { className: 'row' }, [this.button('Got it', back, { kind: 'primary', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: back });
  }

  showCredits(back: () => void): void {
    const panel = el('div', { className: 'panel' }, [
      el('h1', { textContent: 'Credits' }),
      el('p', { textContent: 'Fodeez Nutz started as a 2023 high school final project, written in Java. This is the full remake: the original map and mechanics, a second mode, and a second map.' }),
      el('p', { textContent: 'All art, sound and music are made in code. The three figures near the top of the tower are homages to Getting Over It, Jump King and Pogostuck.' }),
      el('div', { className: 'row' }, [this.button('Back', back, { kind: 'primary', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: back });
  }

  showWin(map: MapId, mode: Mode, stats: Stats, best: Best | undefined, isNewBest: boolean, onWatch: (() => void) | null, onAgain: () => void, onTitle: () => void, unlocked: string[] = []): void {
    const m = getMap(map);
    const rows: [string, string][] = [
      ['Time', formatTime(stats.ticks)],
      ['Falls', String(stats.falls)],
      ['Biggest fall', `${Math.round(stats.biggestFall / m.metersPer)} m`],
      ['Grapples', String(stats.grapples)],
    ];
    if (mode === 'original') rows.push(['Sent back by goop', String(stats.goopResets)]);
    const table = el('dl', { className: 'stats' });
    for (const [k, v] of rows) table.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
    const buttons: HTMLElement[] = [];
    if (onWatch) buttons.push(this.button('Watch replay', onWatch, { kind: 'primary', autofocus: true }));
    buttons.push(this.button('Play again', onAgain, { kind: onWatch ? undefined : 'primary', autofocus: !onWatch }));
    buttons.push(this.button('Title', onTitle, { kind: 'quiet', sound: 'back' }));
    const panel = el('div', { className: 'panel win' }, [
      el('h1', { className: 'yippee', textContent: 'YIPPEE!' }),
      el('p', { className: 'muted', textContent: `You beat ${m.name} in ${modeName(mode)}.` }),
      isNewBest ? el('p', { className: 'badge', textContent: 'New best time' }) : best ? el('p', { className: 'muted', textContent: `Best: ${formatTime(best.ticks)}` }) : '',
      table,
      unlocked.length ? el('div', { className: 'unlocked' }, [el('p', { className: 'muted', textContent: 'Achievements earned' }), ...unlocked.map(u => el('p', { textContent: `★ ${u}` }))]) : '',
      el('div', { className: 'row' }, buttons),
    ]);
    const status = this.h.online.enabled ? el('div', { className: 'online-status' }) : null;
    if (status) panel.insertBefore(status, panel.lastElementChild);
    this.mount(panel, { dim: false });
    this.winStatus = status;
  }
}
