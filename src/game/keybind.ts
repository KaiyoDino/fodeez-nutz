// A key (or key with Ctrl/Alt/Shift/Cmd) the player binds to an action, like "restart from
// the beginning". Matched by e.code, so it's the same physical key whatever the layout; the
// label is what the key printed when it was bound.

export interface KeyBind {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** How to show it, e.g. "Ctrl+R". */
  label: string;
}

/** Keys the game already uses, or that only press a modifier. */
const TAKEN = new Set(['Escape', 'Space', 'Tab', 'Enter', 'NumpadEnter', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'ContextMenu']);
/** With Ctrl (or Cmd), browsers keep these for themselves. */
const BROWSER = new Set(['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'Tab']);

function keyName(e: KeyboardEvent): string {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey ? e.key.toUpperCase() : c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return `Num ${c.slice(6)}`;
  if (/^F\d{1,2}$/.test(c)) return c;
  const named: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down' };
  if (named[c]) return named[c];
  return e.key.length === 1 ? e.key.toUpperCase() : e.key || c;
}

/** The binding a key press makes, or why it can't be one. */
export function bindFromEvent(e: KeyboardEvent): { ok: true; bind: KeyBind } | { ok: false; reason: string } {
  if (!e.code || TAKEN.has(e.code)) return { ok: false, reason: e.code === 'Space' ? 'Space fires the plunger. Pick another key.' : e.code === 'Escape' ? 'Esc pauses. Pick another key.' : 'Pick another key.' };
  if (e.code === 'KeyF' && !(e.ctrlKey || e.altKey || e.metaKey || e.shiftKey)) return { ok: false, reason: 'F is fullscreen. Pick another key.' };
  if ((e.ctrlKey || e.metaKey) && BROWSER.has(e.code)) return { ok: false, reason: 'The browser keeps that one. Pick another key.' };
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && (/Mac|iP/.test(navigator.platform) ? 'Cmd' : 'Win')].filter(Boolean);
  return { ok: true, bind: { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, label: [...mods, keyName(e)].join('+') } };
}

export function matches(bind: KeyBind | null, e: KeyboardEvent): boolean {
  return !!bind && e.code === bind.code && e.ctrlKey === bind.ctrl && e.altKey === bind.alt && e.shiftKey === bind.shift && e.metaKey === bind.meta;
}

/** A binding from the save, or null if it isn't one. */
export function readBind(raw: unknown): KeyBind | null {
  const b = raw as KeyBind;
  if (!b || typeof b !== 'object' || typeof b.code !== 'string' || !b.code || TAKEN.has(b.code) || typeof b.label !== 'string') return null;
  return { code: b.code, ctrl: !!b.ctrl, alt: !!b.alt, shift: !!b.shift, meta: !!b.meta, label: b.label.slice(0, 40) };
}

/** True when a key press is going into a text box (so it isn't a shortcut). */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement ? !['checkbox', 'radio', 'range', 'button'].includes(t.type) : t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
}
