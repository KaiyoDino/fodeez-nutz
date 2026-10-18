// What the leaderboard and community-map parts of the server share: responses, board keys,
// and putting a checked run on a board.

import { getMap, type MapId } from '../src/sim/level';
import { mapHash, packReplay, PHYSICS_VERSION, type Replay } from '../src/sim/replay';
import type { Mode, Stats } from '../src/sim/types';
import type { Store } from './store';

export const BOARD_SIZE = 100;
export const MODES: readonly Mode[] = ['original', 'newage'];
/** Tie-break: an earlier submission ranks above a later one with the same time. */
const EPOCH = Date.UTC(2026, 0, 1);

export interface PublicUser {
  id: string;
  name: string;
  url?: string;
}

export interface Entry {
  name: string;
  url?: string;
  ticks: number;
  falls: number;
  grapples: number;
  date: string;
  wheels?: string;
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra } });
}

export const fail = (status: number, error: string, message: string): Response => json(status, { error, message });

/** A board belongs to one version of the physics and the map; editing either starts a fresh board. */
export const boardVersion = (map: MapId): string => `${PHYSICS_VERSION}-${mapHash(getMap(map))}`;

export const boardKeys = (level: string, version: string) => ({
  board: `b:${level}:${version}`,
  entry: (uid: string) => `e:${level}:${version}:${uid}`,
  replay: (uid: string) => `r:${level}:${version}:${uid}`,
});

/** Put a checked winning run on its level's board, keeping the board at 100. Returns the new rank. */
export async function putOnBoard(store: Store, level: string, version: string, user: PublicUser, r: Replay, stats: Stats, now: number): Promise<number | null> {
  const k = boardKeys(level, version);
  const entry: Entry = { name: user.name, url: user.url, ticks: r.ticks, falls: stats.falls, grapples: stats.grapples, date: new Date(now).toISOString() };
  if (r.wheels) entry.wheels = r.wheels;
  await store.set(k.entry(user.id), JSON.stringify(entry));
  await store.set(k.replay(user.id), JSON.stringify(packReplay({ ...r, date: entry.date, stats: { ...stats } })));
  await store.zadd(k.board, r.ticks + (now - EPOCH) / 1e13, user.id);
  // whoever got pushed off loses their entry and replay
  const off = await store.zrange(k.board, BOARD_SIZE, -1);
  if (off.length) {
    await store.zrem(k.board, ...off.map(o => o.member));
    await store.del(...off.flatMap(o => [k.entry(o.member), k.replay(o.member)]));
  }
  const rank = await store.zrank(k.board, user.id);
  return rank === null ? null : rank + 1;
}
