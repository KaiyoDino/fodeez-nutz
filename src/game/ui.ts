// Menus are plain HTML on top of the canvas (real buttons, so keyboard and screen readers work).

import { bigText } from '../render/font';
import { P } from '../render/palette';
import { formatTime } from '../render/renderer';
import { heightOf } from '../sim/level';
import type { SimState } from '../sim/sim';
import type { Mode, Stats } from '../sim/types';
import type { Best, SaveData, Settings } from './save';

export interface UIHandlers {
  play(mode: Mode, fresh: boolean): void;
  resume(): void;
  restart(): void;
  quitToTitle(): void;
  settingsChanged(s: Settings): void;
  toggleFullscreen(): void;
  sound(kind: 'move' | 'select' | 'back'): void;
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

const METERS = 40;

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

export class UI {
  private root: HTMLElement;
  private h: UIHandlers;
  private escape: (() => void) | null = null;

  constructor(root: HTMLElement, handlers: UIHandlers) {
    this.root = root;
    this.h = handlers;
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.escape && this.root.childElementCount > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.h.sound('back');
        this.escape();
      }
    }, true);
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

  private button(label: string, onClick: () => void, opts: { kind?: 'primary' | 'quiet' | 'danger'; autofocus?: boolean; sound?: 'select' | 'back' } = {}): HTMLButtonElement {
    const b = el('button', { type: 'button', className: `btn ${opts.kind ?? ''}`.trim(), textContent: label });
    if (opts.autofocus) b.dataset.autofocus = '';
    b.addEventListener('click', () => {
      this.h.sound(opts.sound ?? 'select');
      onClick();
    });
    b.addEventListener('mouseenter', () => this.h.sound('move'));
    return b;
  }

  showTitle(save: SaveData): void {
    const run = save.lastMode ? save.runs[save.lastMode] : null;
    const buttons = el('div', { className: 'stack' });
    if (run && save.lastMode) {
      const m = save.lastMode;
      buttons.append(this.button(`Continue · ${MODE_INFO[m].name}`, () => this.h.play(m, false), { kind: 'primary', autofocus: true }));
      buttons.append(this.button('Play', () => this.showModes(save)));
    } else {
      buttons.append(this.button('Play', () => this.showModes(save), { kind: 'primary', autofocus: true }));
    }
    buttons.append(this.button('How to play', () => this.showHowTo(() => this.showTitle(save))));
    buttons.append(this.button('Settings', () => this.showSettings(save.settings, () => this.showTitle(save))));
    buttons.append(this.button('Credits', () => this.showCredits(() => this.showTitle(save))));
    const panel = el('div', { className: 'panel title' }, [
      logo(),
      el('p', { className: 'tagline', textContent: 'No checkpoints. One plunger. A long way up.' }),
      buttons,
      el('p', { className: 'rotate-hint', textContent: 'Tip: turn your phone sideways for a bigger view.' }),
    ]);
    this.mount(panel, { dim: false });
  }

  showModes(save: SaveData): void {
    const cards = el('div', { className: 'modes' });
    for (const mode of ['original', 'newage'] as const) {
      const info = MODE_INFO[mode];
      const run = save.runs[mode];
      const best = save.best[mode];
      const actions = el('div', { className: 'stack' });
      if (run) {
        actions.append(this.button(`Continue (${describeRun(run)})`, () => this.h.play(mode, false), { kind: 'primary', autofocus: mode === save.lastMode }));
        actions.append(this.confirmButton('New run', 'Throw away your current run?', () => this.h.play(mode, true)));
      } else actions.append(this.button('New run', () => this.h.play(mode, true), { kind: 'primary', autofocus: mode === (save.lastMode ?? 'original') }));
      const card = el('section', { className: `card ${mode}` }, [
        el('h2', { textContent: info.name }),
        el('p', { textContent: info.blurb }),
        el('p', { className: 'best', textContent: best ? `Best: ${formatTime(best.ticks)} · ${best.falls} falls` : save.wins[mode] ? '' : 'Not beaten yet' }),
        actions,
      ]);
      cards.append(card);
    }
    const panel = el('div', { className: 'panel wide' }, [el('h1', { textContent: 'Choose a mode' }), cards, el('div', { className: 'row' }, [this.button('Back', () => this.showTitle(save), { kind: 'quiet', sound: 'back' })])]);
    this.mount(panel, { escape: () => this.showTitle(save) });
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

  showPause(mode: Mode, save: SaveData): void {
    const panel = el('div', { className: 'panel' }, [
      el('h1', { textContent: 'Paused' }),
      el('p', { className: 'muted', textContent: `${MODE_INFO[mode].name} · your run is saved` }),
      el('div', { className: 'stack' }, [
        this.button('Resume', () => this.h.resume(), { kind: 'primary', autofocus: true }),
        this.button('Settings', () => this.showSettings(save.settings, () => this.showPause(mode, save))),
        this.button('How to play', () => this.showHowTo(() => this.showPause(mode, save))),
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
      el('div', { className: 'row' }, [this.button('Fullscreen', () => this.h.toggleFullscreen(), { kind: 'quiet' }), this.button('Done', back, { kind: 'primary', sound: 'back' })]),
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
        el('li', { textContent: 'Esc pauses. Space works like the mouse button.' }),
      ]),
      el('div', { className: 'modes compact' }, [
        el('section', { className: 'card original' }, [
          el('h2', { textContent: 'Original' }),
          el('p', { textContent: 'Fire only by clicking well above him. While hooked, gravity flips and pulls you up until you let go or pass the target. Letting go gives a little boost. Stuck in goop too long? Back to the start.' }),
        ]),
        el('section', { className: 'card newage' }, [
          el('h2', { textContent: 'New Age' }),
          el('p', { textContent: 'Fire in any direction. Hooked, you swing on a real rope that winds in faster the longer you hold. You keep your speed when you let go. Goop lets you slide off slowly, then drops you.' }),
        ]),
      ]),
      el('div', { className: 'row' }, [this.button('Got it', back, { kind: 'primary', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: back });
  }

  showCredits(back: () => void): void {
    const panel = el('div', { className: 'panel' }, [
      el('h1', { textContent: 'Credits' }),
      el('p', { textContent: 'Fodeez Nutz started as a 2023 high school final project, written in Java. This is the full remake: same map, same mechanics, now with a second mode.' }),
      el('p', { textContent: 'All art, sound and music are made in code. The three figures near the top are homages to Getting Over It, Jump King and Pogostuck.' }),
      el('div', { className: 'row' }, [this.button('Back', back, { kind: 'primary', sound: 'back' })]),
    ]);
    this.mount(panel, { escape: back });
  }

  showWin(mode: Mode, stats: Stats, best: Best | null, isNewBest: boolean, onAgain: () => void, onTitle: () => void): void {
    const rows: [string, string][] = [
      ['Time', formatTime(stats.ticks)],
      ['Falls', String(stats.falls)],
      ['Biggest fall', `${Math.round(stats.biggestFall / METERS)} m`],
      ['Grapples', String(stats.grapples)],
    ];
    if (mode === 'original') rows.push(['Sent back by goop', String(stats.goopResets)]);
    const table = el('dl', { className: 'stats' });
    for (const [k, v] of rows) table.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
    const panel = el('div', { className: 'panel win' }, [
      el('h1', { className: 'yippee', textContent: 'YIPPEE!' }),
      el('p', { className: 'muted', textContent: `You beat ${MODE_INFO[mode].name}.` }),
      isNewBest ? el('p', { className: 'badge', textContent: 'New best time' }) : best ? el('p', { className: 'muted', textContent: `Best: ${formatTime(best.ticks)}` }) : '',
      table,
      el('div', { className: 'row' }, [this.button('Play again', onAgain, { kind: 'primary', autofocus: true }), this.button('Title', onTitle, { kind: 'quiet', sound: 'back' })]),
    ]);
    this.mount(panel, { dim: false });
  }
}

function describeRun(run: SimState): string {
  return `${formatTime(run.stats.ticks)} · ${Math.max(0, Math.round(heightOf(run.dude.y) / METERS))} m`;
}
