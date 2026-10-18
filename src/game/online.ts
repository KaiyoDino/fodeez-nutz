// Talking to the leaderboard server (server/api.ts): signing in with itch.io, reading the
// top-100 boards, posting runs and fetching other players' replays.
//
// The server's address is baked in at build time with VITE_API_URL. Without it (and outside
// the dev server, which serves the API itself) the game has no online features at all.

import type { MapDoc } from '../sim/custom-map';
import { getMap, type MapId } from '../sim/level';
import { mapHash, packReplay, PHYSICS_VERSION, replayIsCurrent, unpackReplay, type Replay } from '../sim/replay';
import type { Mode } from '../sim/types';

const configured: string | undefined = import.meta.env.DEV ? (import.meta.env.VITE_API_URL ?? '') : import.meta.env.VITE_API_URL;
/** Base URL of the server, '' for this same site, or null when leaderboards are off. */
export const API_URL: string | null = configured === undefined || configured === 'off' ? null : configured.replace(/\/+$/, '');

export interface OnlineUser {
  id: string;
  name: string;
  url?: string;
}

export interface Session {
  token: string;
  user: OnlineUser;
}

export interface BoardEntry {
  rank: number;
  user: OnlineUser;
  ticks: number;
  falls: number;
  grapples: number;
  date: string;
  wheels?: string;
}

export interface Board {
  level: string;
  version: string;
  entries: BoardEntry[];
  signedIn: boolean;
  you: { rank: number; ticks: number } | null;
}

export type SubmitResult =
  | { ok: true; improved: boolean; rank: number | null; ticks?: number; cutoff?: number }
  | { ok: false; error: string; message: string };

/** A community map as the server lists it. */
export interface MapSummary {
  id: string;
  name: string;
  mode: Mode;
  theme: MapDoc['theme'];
  creator: OnlineUser;
  created: string;
  pieces: number;
  /** The creator's winning time. */
  creatorTicks: number;
  rating: { avg: number | null; count: number };
  /** How many other players have beaten it, and their average time on that first win. */
  clears: number;
  avgTicks: number | null;
}

export type MapSort = 'top' | 'new' | 'clears';

/** How hard a community map is, from how long other players took to beat it the first time. */
export function difficulty(m: Pick<MapSummary, 'avgTicks' | 'clears'>): string {
  if (m.avgTicks === null || !m.clears) return 'Difficulty unknown';
  const min = m.avgTicks / 3600;
  return min < 1 ? 'Easy' : min < 5 ? 'Medium' : min < 20 ? 'Hard' : 'Brutal';
}

/** What the server calls a level: one map in one mode. */
export const levelId = (map: MapId, mode: Mode) => `${map}:${mode}`;
/** The board version this copy of the game plays (it must match the server's). */
export const localVersion = (map: MapId) => `${PHYSICS_VERSION}-${mapHash(getMap(map))}`;

export class OnlineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const isSession = (s: unknown): s is Session => !!s && typeof (s as Session).token === 'string' && typeof (s as Session).user?.id === 'string' && typeof (s as Session).user?.name === 'string';

export function readSession(raw: unknown): Session | null {
  return isSession(raw) ? { token: raw.token, user: { id: raw.user.id, name: raw.user.name, url: raw.user.url } } : null;
}

export class Online {
  session: Session | null;
  private onChange: (s: Session | null) => void;

  constructor(session: Session | null, onChange: (s: Session | null) => void) {
    this.session = session;
    this.onChange = onChange;
  }

  get enabled(): boolean {
    return API_URL !== null;
  }

  private setSession(s: Session | null): void {
    this.session = s;
    this.onChange(s);
  }

  private async call<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
    if (API_URL === null) throw new OnlineError('offline', 'Leaderboards aren’t available in this copy of the game.');
    const headers = new Headers(init.headers);
    if (auth && this.session) headers.set('Authorization', `Bearer ${this.session.token}`);
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, { ...init, headers });
    } catch {
      throw new OnlineError('network', 'Couldn’t reach the leaderboard server. Check your connection.');
    }
    const body = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
    if (!res.ok || !body) {
      if (res.status === 401 && auth) this.setSession(null);
      throw new OnlineError(body?.error ?? 'server', body?.message ?? `The leaderboard server had a problem (${res.status}).`);
    }
    return body;
  }

  /** Where the sign-in tab goes, for a fresh login id. */
  signInUrl(): { url: string; lid: string } {
    const a = crypto.getRandomValues(new Uint8Array(16));
    const lid = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
    const base = API_URL ?? '';
    const url = new URL(`${base}/api/auth/start?lid=${lid}`, window.location.href).href;
    return { url, lid };
  }

  /** Polls until the sign-in tab finishes (or `signal` aborts or ten minutes pass). */
  async waitForSignIn(lid: string, signal: AbortSignal): Promise<Session | null> {
    const until = Date.now() + 10 * 60 * 1000;
    while (!signal.aborted && Date.now() < until) {
      await new Promise(r => setTimeout(r, 1500));
      if (signal.aborted) break;
      try {
        const r = await this.call<{ status: string; token?: string; user?: OnlineUser }>(`/api/auth/poll?lid=${lid}`);
        if (r.status === 'done') {
          const s = readSession(r);
          if (s && !signal.aborted) {
            this.setSession(s);
            return s;
          }
        }
      } catch {
        // keep trying through brief network trouble
      }
    }
    return null;
  }

  signOut(): void {
    const s = this.session;
    this.setSession(null);
    if (s && API_URL !== null) fetch(`${API_URL}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` } }).catch(() => undefined);
  }

  async board(map: MapId, mode: Mode): Promise<Board> {
    const b = await this.call<Board>(`/api/board?level=${levelId(map, mode)}`, {}, true);
    if (this.session && !b.signedIn) this.setSession(null); // the server forgot this session
    return b;
  }

  async replay(map: MapId, mode: Mode, user: string): Promise<Replay> {
    const raw = await this.call<unknown>(`/api/replay?level=${levelId(map, mode)}&user=${encodeURIComponent(user)}`);
    const r = unpackReplay(raw);
    if (!r) throw new OnlineError('bad-replay', 'That replay couldn’t be read.');
    return r;
  }

  async listMaps(sort: MapSort, offset = 0): Promise<{ maps: MapSummary[]; more: boolean }> {
    return this.call(`/api/maps?sort=${sort}&offset=${offset}`);
  }

  async getMap(id: string): Promise<{ map: MapSummary; doc: MapDoc; yourRating: number | null; version: string }> {
    return this.call(`/api/maps/get?id=${encodeURIComponent(id)}`, {}, true);
  }

  async myMaps(): Promise<MapSummary[]> {
    return (await this.call<{ maps: MapSummary[] }>('/api/maps/mine', {}, true)).maps;
  }

  /** Upload a map with the creator's winning run on it. */
  async uploadMap(doc: MapDoc, run: Replay): Promise<{ ok: true; map: MapSummary } | { ok: false; error: string; message: string }> {
    try {
      return await this.call('/api/maps/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc, replay: packReplay(run) }) }, true);
    } catch (e) {
      const err = e as OnlineError;
      return { ok: false, error: err.code ?? 'server', message: err.message };
    }
  }

  async rateMap(id: string, stars: number): Promise<{ rating: MapSummary['rating']; yourRating: number }> {
    return this.call('/api/maps/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, stars }) }, true);
  }

  async deleteMap(id: string): Promise<void> {
    await this.call(`/api/maps/delete?id=${encodeURIComponent(id)}`, { method: 'POST' }, true);
  }

  /** Post a winning run. Only runs recorded with this version of the game can go on the board. */
  async submit(replay: Replay): Promise<SubmitResult> {
    if (!this.session) return { ok: false, error: 'signed-out', message: 'Sign in to post times.' };
    if (!replay.won || replay.by !== 'player' || !replayIsCurrent(replay)) return { ok: false, error: 'outdated', message: 'This run is from an older version of the game.' };
    try {
      return await this.call<SubmitResult>('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packReplay(replay)) }, true);
    } catch (e) {
      const err = e as OnlineError;
      return { ok: false, error: err.code ?? 'server', message: err.message };
    }
  }
}
