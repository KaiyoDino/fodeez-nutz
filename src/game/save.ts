// Settings, the run in progress for each mode, and best times, in localStorage.
// Every read and write is guarded: private windows or blocked storage just mean nothing is remembered.

import { loadSimState, type SimState } from '../sim/sim';
import type { Mode } from '../sim/types';

const KEY = 'fodeez-nutz/v1';

export interface Settings {
  music: number;
  sfx: number;
  shake: boolean;
  aimGuide: boolean;
  showTimer: boolean;
}

export interface Best {
  ticks: number;
  falls: number;
  date: string;
}

export interface SaveData {
  settings: Settings;
  runs: Record<Mode, SimState | null>;
  best: Record<Mode, Best | null>;
  wins: Record<Mode, number>;
  lastMode: Mode | null;
}

export const DEFAULT_SETTINGS: Settings = { music: 0.6, sfx: 0.8, shake: true, aimGuide: true, showTimer: true };

function empty(): SaveData {
  return {
    settings: { ...DEFAULT_SETTINGS },
    runs: { original: null, newage: null },
    best: { original: null, newage: null },
    wins: { original: 0, newage: 0 },
    lastMode: null,
  };
}

export function loadSave(): SaveData {
  const data = empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return data;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    if (parsed.settings) {
      const s = parsed.settings;
      data.settings = {
        music: typeof s.music === 'number' ? clamp01(s.music) : DEFAULT_SETTINGS.music,
        sfx: typeof s.sfx === 'number' ? clamp01(s.sfx) : DEFAULT_SETTINGS.sfx,
        shake: typeof s.shake === 'boolean' ? s.shake : DEFAULT_SETTINGS.shake,
        aimGuide: typeof s.aimGuide === 'boolean' ? s.aimGuide : DEFAULT_SETTINGS.aimGuide,
        showTimer: typeof s.showTimer === 'boolean' ? s.showTimer : DEFAULT_SETTINGS.showTimer,
      };
    }
    for (const mode of ['original', 'newage'] as const) {
      const run = parsed.runs?.[mode];
      const state = run ? loadSimState(run) : null;
      data.runs[mode] = state && state.mode === mode && !state.won ? state : null;
      const best = parsed.best?.[mode];
      if (best && typeof best.ticks === 'number') data.best[mode] = best;
      const wins = parsed.wins?.[mode];
      if (typeof wins === 'number') data.wins[mode] = wins;
    }
    if (parsed.lastMode === 'original' || parsed.lastMode === 'newage') data.lastMode = parsed.lastMode;
  } catch {
    // unreadable or blocked storage: start fresh
  }
  return data;
}

export function writeSave(data: SaveData): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or blocked: nothing we can do
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
