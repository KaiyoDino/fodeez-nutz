import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { BOARD_SIZE, boardVersion, createApi } from '../server/api';
import { MemoryStore } from '../server/store';
import { packReplay, unpackReplay, verifyReplay, type Replay } from '../src/sim/replay';

const routes = join(import.meta.dirname, '..', 'src', 'data', 'routes');
/** A bot route, dressed up as a player's run. */
const run = (name: string): Replay => ({ ...(JSON.parse(readFileSync(join(routes, `${name}.json`), 'utf8')) as Replay), by: 'player' });

const ORIGIN = 'https://game.example';

/** Stands in for itch.io's token and profile endpoints. */
function fakeItch(users: Record<string, { id: number; username: string; display_name?: string }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.itch.io/oauth/token') {
      const form = new URLSearchParams(String(init?.body));
      const code = form.get('code') ?? '';
      if (!users[code] || !form.get('code_verifier') || form.get('client_id') !== 'client-1') return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      return new Response(JSON.stringify({ access_token: `tok-${code}`, token_type: 'bearer', scope: 'profile:me' }));
    }
    if (url === 'https://api.itch.io/profile') {
      const code = String(new Headers(init?.headers).get('Authorization')).replace('Bearer tok-', '');
      const u = users[code];
      return u ? new Response(JSON.stringify({ user: { ...u, url: `https://${u.username}.itch.io` } })) : new Response('{}', { status: 401 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

let store: MemoryStore;
let api: (req: Request) => Promise<Response>;

beforeEach(() => {
  store = new MemoryStore();
  api = createApi({
    store,
    itch: { clientId: 'client-1' },
    adminToken: 'admin-secret',
    fetch: fakeItch({ alice: { id: 1, username: 'alice', display_name: 'Alice' }, bob: { id: 2, username: 'bob' } }),
  });
});

const get = (path: string, token?: string) => api(new Request(ORIGIN + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
const post = (path: string, body: unknown, token?: string) =>
  api(new Request(ORIGIN + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }));

/** Go through the whole sign-in: start, itch.io's redirect back, and the game's poll. */
async function signIn(code: string): Promise<string> {
  const lid = (code + '0'.repeat(32)).slice(0, 32).replace(/[^0-9a-f]/g, 'a');
  const start = await get(`/api/auth/start?lid=${lid}`);
  expect(start.status).toBe(302);
  const to = new URL(start.headers.get('Location')!);
  expect(to.origin + to.pathname).toBe('https://itch.io/user/oauth');
  expect(to.searchParams.get('code_challenge_method')).toBe('S256');
  expect(to.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`);
  expect(to.searchParams.get('scope')).toBe('profile:me');
  const pending = await (await get(`/api/auth/poll?lid=${lid}`)).json();
  expect(pending.status).toBe('pending');
  const back = await get(`/api/auth/callback?code=${code}&state=${to.searchParams.get('state')}`);
  expect(back.status).toBe(200);
  const done = await (await get(`/api/auth/poll?lid=${lid}`)).json();
  expect(done.status).toBe('done');
  // the session can only be picked up once
  expect((await (await get(`/api/auth/poll?lid=${lid}`)).json()).status).toBe('pending');
  return done.token as string;
}

describe('sign-in', () => {
  it('signs in with itch.io and knows who you are', async () => {
    const token = await signIn('alice');
    const me = await (await get('/api/me', token)).json();
    expect(me.user).toEqual({ id: 'itch-1', name: 'Alice', url: 'https://alice.itch.io' });
    // signing out ends the session
    await post('/api/auth/logout', {}, token);
    expect((await get('/api/me', token)).status).toBe(401);
  });

  it('refuses a callback it did not start, and one that itch.io rejects', async () => {
    expect((await get('/api/auth/callback?code=alice&state=' + 'f'.repeat(32))).status).toBe(400);
    const start = await get(`/api/auth/start?lid=${'b'.repeat(32)}`);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state');
    expect((await get(`/api/auth/callback?code=mallory&state=${state}`)).status).toBe(502);
  });
});

describe('leaderboards', () => {
  it('replays a submitted run and ranks it', async () => {
    const token = await signIn('alice');
    const r = run('tower-newage');
    const res = await post('/api/submit', packReplay({ ...r, wheels: 'neon' }), token);
    expect(await res.json()).toMatchObject({ ok: true, improved: true, rank: 1, ticks: r.ticks });
    const board = await (await get('/api/board?level=tower:newage', token)).json();
    expect(board.version).toBe(boardVersion('tower'));
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]).toMatchObject({ rank: 1, user: { id: 'itch-1', name: 'Alice' }, ticks: r.ticks, wheels: 'neon' });
    expect(board.you).toEqual({ rank: 1, ticks: r.ticks });
    // and the replay can be fetched and still wins
    const back = unpackReplay(await (await get('/api/replay?level=tower:newage&user=itch-1')).json());
    expect(back).not.toBeNull();
    expect(verifyReplay(back!).won).toBe(true);
    expect(back!.stats?.ticks).toBe(r.ticks);
  });

  it('keeps only your best time', async () => {
    const token = await signIn('alice');
    const r = run('crane-original');
    await post('/api/submit', packReplay(r), token);
    // the same run again isn't an improvement (and isn't replayed again)
    expect(await (await post('/api/submit', packReplay(r), token)).json()).toMatchObject({ ok: true, improved: false, rank: 1 });
  });

  it('rejects runs that do not add up', async () => {
    const token = await signIn('bob');
    const r = run('tower-original');
    // claims a faster time than the inputs give
    expect((await post('/api/submit', packReplay({ ...r, ticks: r.ticks - 60 }), token)).status).toBe(422);
    // the inputs with one shot taken out don't win
    expect((await post('/api/submit', packReplay({ ...r, inputs: r.inputs.slice(2) }), token)).status).toBe(422);
    // debug teleports
    expect((await post('/api/submit', packReplay({ ...r, inputs: [{ tick: 0, kind: 'teleport', x: 3, y: 0 }, ...r.inputs] }), token)).status).toBe(422);
    // recorded on another version of the map or physics
    expect((await post('/api/submit', packReplay({ ...r, mapHash: 'deadbeef' }), token)).status).toBe(409);
    expect((await post('/api/submit', packReplay({ ...r, physics: 1 }), token)).status).toBe(409);
    // garbage
    expect((await post('/api/submit', '{"v":1,"i":"nope"}', token)).status).toBe(400);
    expect((await post('/api/submit', 'not json', token)).status).toBe(400);
    // not signed in
    expect((await post('/api/submit', packReplay(r))).status).toBe(401);
    const board = await (await get('/api/board?level=tower:original')).json();
    expect(board.entries).toEqual([]);
  });

  it('keeps the top 100 and drops whoever falls off', async () => {
    const level = 'tower:newage';
    const v = boardVersion('tower');
    // fill the board with slower times than the bot's
    for (let i = 0; i < BOARD_SIZE; i++) {
      const uid = `itch-${1000 + i}`;
      await store.zadd(`b:${level}:${v}`, 5000 + i, uid);
      await store.set(`e:${level}:${v}:${uid}`, JSON.stringify({ name: `p${i}`, ticks: 5000 + i, falls: 0, grapples: 0, date: '' }));
      await store.set(`r:${level}:${v}:${uid}`, '{}');
    }
    const token = await signIn('alice');
    const res = await (await post('/api/submit', packReplay(run('tower-newage')), token)).json();
    expect(res).toMatchObject({ ok: true, improved: true, rank: 1 });
    expect(await store.zcard(`b:${level}:${v}`)).toBe(BOARD_SIZE);
    expect(await store.get(`e:${level}:${v}:itch-1099`)).toBeNull();
    expect(await store.get(`r:${level}:${v}:itch-1099`)).toBeNull();
    // a slower run than the 100th doesn't even get replayed
    const slow = run('tower-newage');
    const tok2 = await signIn('bob');
    await store.zadd(`b:${level}:${v}`, 10, 'itch-9999'); // pretend the board's full of fast times
    for (let i = 0; i < BOARD_SIZE; i++) await store.zadd(`b:${level}:${v}`, i, `itch-${1000 + i}`);
    expect(await (await post('/api/submit', packReplay(slow), tok2)).json()).toMatchObject({ ok: true, improved: false, rank: null });
  });

  it('lets the admin remove an entry and ban a player', async () => {
    const token = await signIn('alice');
    await post('/api/submit', packReplay(run('tower-newage')), token);
    expect((await post('/api/admin/remove?level=tower:newage&user=itch-1&ban=1', {}, 'wrong')).status).toBe(404);
    const removed = await api(new Request(`${ORIGIN}/api/admin/remove?level=tower:newage&user=itch-1&ban=1`, { method: 'POST', headers: { Authorization: 'Bearer admin-secret' } }));
    expect(removed.status).toBe(200);
    expect((await (await get('/api/board?level=tower:newage')).json()).entries).toEqual([]);
    expect((await post('/api/submit', packReplay(run('tower-newage')), token)).status).toBe(403);
  });

  it('answers CORS preflights and unknown levels', async () => {
    const pre = await api(new Request(`${ORIGIN}/api/submit`, { method: 'OPTIONS' }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await get('/api/board?level=moon:newage')).status).toBe(400);
  });
});

describe('packed replays', () => {
  it('round-trip', () => {
    const r = run('crane-newage');
    const back = unpackReplay(JSON.parse(JSON.stringify(packReplay(r))));
    expect(back?.inputs).toEqual(r.inputs);
    expect(back?.ticks).toBe(r.ticks);
  });
});
