// Menus are plain HTML on top of the canvas (real buttons, so keyboard and screen readers work).

import { bigText } from '../render/font';
import { P } from '../render/palette';
import { formatTime } from '../render/renderer';
import { getMap, heightOf, MAP_IDS, type MapId } from '../sim/level';
import type { Replay } from '../sim/replay';
import type { Mode, Stats } from '../sim/types';
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
    blurb: 'Rebuilt physics. The rope really swings and winds you in while you hold, you can fire in any direction, and goop lets you slide off slowly before it drops you.',
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

function describeRun(run: SavedRun): string {
  const map = getMap(run.state.world.map);
  return `${formatTime(run.state.stats.ticks)} · ${Math.max(0, Math.round(heightOf(map, run.state.dude.y) / map.metersPer))} m`;
}

export class UI {
  private root: HTMLElement;
  private barRoot: HTMLElement;
  private h: UIHandlers;
  private escape: (() => void) | null = null;
  private bar: { update(tick: number, end: number, speed: number, paused: boolean, done: boolean): void } | null = null;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.h = handlers;
    this.barRoot = el('div', { className: 'replay-bar-root' });
    document.body.append(this.barRoot);
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
  }

  private mount(panel: HTMLElement, opts: { escape?: () => void; dim?: boolean } = {}): void {
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
    if (hasReplays) buttons.append(this.button('Replays', () => this.h.openReplays(() => this.showTitle(save, hasReplays))));
    buttons.append(this.button('How to play', () => this.showHowTo(() => this.showTitle(save, hasReplays))));
    buttons.append(this.button('Settings', () => this.showSettings(save.settings, () => this.showTitle(save, hasReplays))));
    buttons.append(this.button('Credits', () => this.showCredits(() => this.showTitle(save, hasReplays))));
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
          list.append(
            el('div', { className: 'replay-row' }, [
              el('span', { className: 'who', textContent: who }),
              el('span', { className: 'what', textContent: modeName(mode) }),
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
    this.bar = {
      update: (tick, end, speed, paused, done) => {
        play.textContent = done ? 'Restart' : paused ? 'Play' : 'Pause';
        for (const { sp, b } of speedButtons) b.classList.toggle('active', sp === speed);
        if (!dragging) seek.value = String(Math.round((tick / Math.max(1, end)) * 1000));
        time.textContent = `${formatTime(tick)} / ${formatTime(end)}`;
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
    const panel = el('div', { className: 'panel' }, [
      el('h1', { textContent: 'Settings' }),
      el('div', { className: 'settings' }, [
        slider('set-music', 'Music', 'music'),
        slider('set-sfx', 'Sound effects', 'sfx'),
        toggle('set-aim', 'Aim guide', 'aimGuide'),
        toggle('set-timer', 'Show timer', 'showTimer'),
        toggle('set-shake', 'Screen shake', 'shake'),
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
        el('li', { textContent: 'Hold to hang on, let go to fly. You get 3 shots per jump. Landing or goop refills them.' }),
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
          el('p', { textContent: 'Fire in any direction. Hooked, you swing on a real rope that winds in faster the longer you hold. You keep your speed when you let go, so time your release to fling yourself. Goop lets you slide off slowly, then drops you.' }),
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

  showWin(map: MapId, mode: Mode, stats: Stats, best: Best | undefined, isNewBest: boolean, onWatch: (() => void) | null, onAgain: () => void, onTitle: () => void): void {
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
      el('div', { className: 'row' }, buttons),
    ]);
    this.mount(panel, { dim: false });
  }
}
