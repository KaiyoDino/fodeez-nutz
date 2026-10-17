// Settings, the run in progress for each map and mode, best times and replays, in localStorage.
// Every read and write is guarded: private windows or blocked storage just mean nothing is remembered.

import { MAPS, type MapId } from '../sim/level';
import { isReplay, type RecordedInput, type Replay } from '../sim/replay';
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

export type RunKey = `${MapId}:${Mode}`;
export const runKey = (map: MapId, mode: Mode): RunKey => `${map}:${mode}`;

export interface SavedRun {
  state: SimState;
  /** Every input so far, for the replay. Null for runs started before replays existed. */
  inputs: RecordedInput[] | null;
}

export interface SaveData {
  v: 2;
  settings: Settings;
  runs: Partial<Record<RunKey, SavedRun>>;
  best: Partial<Record<RunKey, Best>>;
  wins: Partial<Record<RunKey, number>>;
  /** Your fastest win and your most recent win, per map and mode. */
  replays: Partial<Record<RunKey, { best?: Replay; last?: Replay }>>;
  last: { map: MapId; mode: Mode } | null;
}

const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const DEFAULT_SETTINGS: Settings = { music: 0.6, sfx: 0.8, shake: !prefersReducedMotion(), aimGuide: true, showTimer: true };

function empty(): SaveData {
  return { v: 2, settings: { ...DEFAULT_SETTINGS }, runs: {}, best: {}, wins: {}, replays: {}, last: null };
}

const MODES: Mode[] = ['original', 'newage'];
const isMode = (m: unknown): m is Mode => m === 'original' || m === 'newage';
const isMap = (m: unknown): m is MapId => typeof m === 'string' && m in MAPS;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function readSettings(raw: Partial<Settings> | undefined): Settings {
  const s = raw ?? {};
  return {
    music: typeof s.music === 'number' ? clamp01(s.music) : DEFAULT_SETTINGS.music,
    sfx: typeof s.sfx === 'number' ? clamp01(s.sfx) : DEFAULT_SETTINGS.sfx,
    shake: typeof s.shake === 'boolean' ? s.shake : DEFAULT_SETTINGS.shake,
    aimGuide: typeof s.aimGuide === 'boolean' ? s.aimGuide : DEFAULT_SETTINGS.aimGuide,
    showTimer: typeof s.showTimer === 'boolean' ? s.showTimer : DEFAULT_SETTINGS.showTimer,
  };
}

function readRun(raw: unknown, key: RunKey): SavedRun | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as SavedRun;
  const state = loadSimState(r.state);
  if (!state || state.won || `${state.world.map}:${state.mode}` !== key) return undefined;
  const inputs = Array.isArray(r.inputs) ? r.inputs : null;
  return { state, inputs };
}

const isBest = (b: unknown): b is Best => !!b && typeof (b as Best).ticks === 'number';

/** The first version stored one run per mode on the tower, with no replays. */
function migrateV1(parsed: Record<string, unknown>, data: SaveData): void {
  const runs = (parsed.runs ?? {}) as Record<string, unknown>;
  const best = (parsed.best ?? {}) as Record<string, unknown>;
  const wins = (parsed.wins ?? {}) as Record<string, unknown>;
  for (const mode of MODES) {
    const key = runKey('tower', mode);
    const state = loadSimState(runs[mode]);
    if (state && !state.won) data.runs[key] = { state, inputs: null };
    if (isBest(best[mode])) data.best[key] = best[mode] as Best;
    if (typeof wins[mode] === 'number') data.wins[key] = wins[mode] as number;
  }
  if (isMode(parsed.lastMode)) data.last = { map: 'tower', mode: parsed.lastMode };
}

export function loadSave(): SaveData {
  const data = empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return data;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    data.settings = readSettings(parsed.settings as Partial<Settings> | undefined);
    if (parsed.v !== 2) {
      migrateV1(parsed, data);
      return data;
    }
    const p = parsed as unknown as SaveData;
    for (const map of Object.keys(MAPS) as MapId[])
      for (const mode of MODES) {
        const key = runKey(map, mode);
        const run = readRun(p.runs?.[key], key);
        if (run) data.runs[key] = run;
        if (isBest(p.best?.[key])) data.best[key] = p.best![key];
        if (typeof p.wins?.[key] === 'number') data.wins[key] = p.wins[key];
        const r = p.replays?.[key];
        if (r) data.replays[key] = { best: isReplay(r.best) ? r.best : undefined, last: isReplay(r.last) ? r.last : undefined };
      }
    if (p.last && isMap(p.last.map) && isMode(p.last.mode)) data.last = p.last;
  } catch {
    // unreadable or blocked storage: start fresh
  }
  return data;
}

export function writeSave(data: SaveData): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked. Drop the bulkiest thing (old "last win" replays) and try once more.
    try {
      for (const k of Object.keys(data.replays) as RunKey[]) if (data.replays[k]) delete data.replays[k]!.last;
      window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // nothing more we can do
    }
  }
}
