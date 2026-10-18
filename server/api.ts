// The leaderboard server: itch.io sign-in, top-100 boards per level, and replays.
//
// It's one function from a web Request to a Response, so it runs the same on Vercel (see
// vercel.ts), in the Vite dev server (tools/api-plugin.ts) and in the tests. Every submitted
// run is replayed here with the game's own simulation, so a time only gets on the board if
// the inputs really win the level in that many ticks.
//
// Signing in (the game runs in an itch.io iframe, where redirects and popups are unreliable):
//   1. The game makes a random login id and opens /api/auth/start?lid=<id> in a new tab.
//   2. That page sends the player to itch.io (OAuth with PKCE), which comes back to /api/auth/callback.
//   3. The server reads the player's itch.io profile, makes a session, and parks it under the login id.
//   4. Meanwhile the game polls /api/auth/poll?lid=<id> and picks the session up (once).
// The game only ever holds our own session token; the itch.io token is used once and dropped.

import { getMap, MAPS, type MapId } from '../src/sim/level';
import { mapHash, packReplay, PHYSICS_VERSION, unpackReplay, verifyReplay } from '../src/sim/replay';
import type { Mode } from '../src/sim/types';
import type { Store } from './store';

export const BOARD_SIZE = 100;
/** Longest run the server will check: 10 hours of play (about a minute of CPU). */
export const MAX_RUN_TICKS = 10 * 60 * 60 * 60;
/** Biggest submission accepted, in bytes of JSON. */
export const MAX_BODY = 3_000_000;
const SESSION_TTL = 60 * 60 * 24 * 365 * 2;
const LOGIN_TTL = 15 * 60;
const SUBMITS_PER_MINUTE = 12;
/** Tie-break: an earlier submission ranks above a later one with the same time. */
const EPOCH = Date.UTC(2026, 0, 1);

export interface ItchConfig {
  clientId: string;
  /** Must match the redirect URI registered with the itch.io OAuth app. Default: <this origin>/api/auth/callback. */
  redirectUri?: string;
}

export interface ApiConfig {
  store: Store;
  /** itch.io OAuth app. Null: sign-in isn't available (unless devLogin). */
  itch: ItchConfig | null;
  /** Dev server only: sign in by typing any name, no itch.io account needed. */
  devLogin?: boolean;
  /** Bearer token for /api/admin/remove. Unset: no admin endpoint. */
  adminToken?: string;
  /** For tests: stands in for fetch when talking to itch.io. */
  fetch?: typeof fetch;
  now?: () => number;
}

export interface PublicUser {
  id: string;
  name: string;
  url?: string;
}

interface Entry {
  name: string;
  url?: string;
  ticks: number;
  falls: number;
  grapples: number;
  date: string;
  wheels?: string;
}

const MODES: readonly Mode[] = ['original', 'newage'];

/** "tower:newage" and friends. Returns null for anything else. */
export function parseLevel(level: string | null): { map: MapId; mode: Mode; level: string } | null {
  const [map, mode] = (level ?? '').split(':');
  if (!(map in MAPS) || !MODES.includes(mode as Mode)) return null;
  return { map: map as MapId, mode: mode as Mode, level: `${map}:${mode}` };
}

/** A board belongs to one version of the physics and the map; editing either starts a fresh board. */
export const boardVersion = (map: MapId): string => `${PHYSICS_VERSION}-${mapHash(getMap(map))}`;

const keys = (level: string, version: string) => ({
  board: `b:${level}:${version}`,
  entry: (uid: string) => `e:${level}:${version}:${uid}`,
  replay: (uid: string) => `r:${level}:${version}:${uid}`,
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra } });
}

const fail = (status: number, error: string, message: string) => json(status, { error, message });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** The small pages shown in the sign-in tab. */
function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Fodeez Nutz</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0b20;color:#f6f6f2;font:18px/1.5 'Courier New',monospace;padding:16px;box-sizing:border-box}
main{max-width:440px;background:#1b1838;padding:24px;box-shadow:0 0 0 4px #1a1c2c,0 0 0 8px #3d4257,0 0 0 12px #1a1c2c}
h1{color:#ffc23a;font-size:26px;margin:0 0 12px;font-weight:400}p{margin:0 0 12px}.muted{color:#b9b3d9}
input,button{font:inherit;padding:8px 12px}button{background:#c9402b;color:#f6f6f2;border:0;cursor:pointer}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

function randomHex(bytes: number): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const isLoginId = (lid: string | null): lid is string => !!lid && /^[0-9a-f]{32}$/.test(lid);

export function createApi(cfg: ApiConfig): (req: Request) => Promise<Response> {
  const { store } = cfg;
  const now = cfg.now ?? Date.now;
  const fetcher = cfg.fetch ?? fetch;

  async function userFor(req: Request): Promise<PublicUser | null> {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '');
    if (!m) return null;
    const uid = await store.get(`sess:${m[1]}`);
    if (!uid) return null;
    const raw = await store.get(`user:${uid}`);
    return raw ? (JSON.parse(raw) as PublicUser) : null;
  }

  /** Make a session for a signed-in player and leave it for the game to pick up. */
  async function finishLogin(user: PublicUser, lid: string): Promise<Response> {
    const token = randomHex(32);
    await store.set(`user:${user.id}`, JSON.stringify(user));
    await store.set(`sess:${token}`, user.id, { ttl: SESSION_TTL });
    await store.set(`login:${lid}`, JSON.stringify({ token, user }), { ttl: LOGIN_TTL });
    return page(
      `Signed in`,
      `<p>Hi, <b>${escapeHtml(user.name)}</b>! You're signed in.</p><p class="muted">Go back to the game. It notices by itself in a moment, and you can close this tab.</p>
<script>setTimeout(function(){try{window.close()}catch(e){}},2500)</script>`,
    );
  }

  async function authStart(url: URL): Promise<Response> {
    const lid = url.searchParams.get('lid');
    if (!isLoginId(lid)) return page('Sign-in link is broken', '<p>Start signing in again from the game.</p>', 400);
    if (!cfg.itch) {
      if (!cfg.devLogin) return page('Sign-in is not set up', '<p class="muted">This server has no itch.io app configured.</p>', 503);
      return page(
        'Dev sign-in',
        `<p class="muted">Local dev server: no itch.io account needed. Pick any name.</p>
<form method="post" action="dev-login"><input type="hidden" name="lid" value="${lid}"><p><input name="name" aria-label="Name" value="dev" maxlength="24" autofocus></p><p><button type="submit">Sign in</button></p></form>`,
      );
    }
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = randomHex(16);
    await store.set(`oauth:${state}`, JSON.stringify({ verifier, lid }), { ttl: LOGIN_TTL });
    const q = new URLSearchParams({
      client_id: cfg.itch.clientId,
      scope: 'profile:me',
      response_type: 'code',
      redirect_uri: cfg.itch.redirectUri ?? `${url.origin}/api/auth/callback`,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return new Response(null, { status: 302, headers: { Location: `https://itch.io/user/oauth?${q}`, 'Cache-Control': 'no-store' } });
  }

  async function authCallback(url: URL): Promise<Response> {
    const state = url.searchParams.get('state') ?? '';
    const pending = /^[0-9a-f]{32}$/.test(state) ? await store.take(`oauth:${state}`) : null;
    if (url.searchParams.get('error')) return page('Not signed in', '<p>You can close this tab. Your times stay on this device.</p>');
    if (!pending || !cfg.itch) return page('Sign-in expired', '<p>That took too long or the link was used already. Start signing in again from the game.</p>', 400);
    const { verifier, lid } = JSON.parse(pending) as { verifier: string; lid: string };
    const tokenRes = await fetcher('https://api.itch.io/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: url.searchParams.get('code') ?? '',
        code_verifier: verifier,
        redirect_uri: cfg.itch.redirectUri ?? `${url.origin}/api/auth/callback`,
        client_id: cfg.itch.clientId,
      }),
    });
    const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokenRes.ok || !tok.access_token) return page('Sign-in failed', '<p>itch.io didn’t accept the sign-in. Try again from the game.</p>', 502);
    const profRes = await fetcher('https://api.itch.io/profile', { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const prof = (await profRes.json().catch(() => ({}))) as { user?: { id?: number; username?: string; display_name?: string; url?: string } };
    const u = prof.user;
    if (!profRes.ok || !u || typeof u.id !== 'number' || !u.username) return page('Sign-in failed', '<p>Couldn’t read your itch.io profile. Try again from the game.</p>', 502);
    const name = (u.display_name || u.username).slice(0, 40);
    return finishLogin({ id: `itch-${u.id}`, name, url: typeof u.url === 'string' ? u.url : undefined }, lid);
  }

  async function devLogin(req: Request): Promise<Response> {
    if (!cfg.devLogin) return fail(404, 'not-found', 'No such endpoint.');
    const form = new URLSearchParams(await req.text());
    const lid = form.get('lid');
    const name = (form.get('name') ?? '').trim().slice(0, 24) || 'dev';
    if (!isLoginId(lid)) return page('Sign-in link is broken', '<p>Start again from the game.</p>', 400);
    const id = `dev-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return finishLogin({ id, name }, lid);
  }

  async function board(url: URL, req: Request): Promise<Response> {
    const lv = parseLevel(url.searchParams.get('level'));
    if (!lv) return fail(400, 'bad-level', 'Unknown level.');
    const version = boardVersion(lv.map);
    const k = keys(lv.level, version);
    const top = await store.zrange(k.board, 0, BOARD_SIZE - 1);
    const raw = await store.mget(top.map(t => k.entry(t.member)));
    const entries = top.flatMap((t, i) => {
      const e = raw[i] ? (JSON.parse(raw[i]!) as Entry) : null;
      if (!e) return [];
      return [{ rank: i + 1, user: { id: t.member, name: e.name, url: e.url }, ticks: e.ticks, falls: e.falls, grapples: e.grapples, date: e.date, wheels: e.wheels }];
    });
    const me = await userFor(req);
    let you: { rank: number; ticks: number } | null = null;
    if (me) {
      const rank = await store.zrank(k.board, me.id);
      const score = await store.zscore(k.board, me.id);
      if (rank !== null && score !== null) you = { rank: rank + 1, ticks: Math.floor(score) };
    }
    return json(200, { level: lv.level, version, size: BOARD_SIZE, entries, signedIn: !!me, you });
  }

  async function replay(url: URL): Promise<Response> {
    const lv = parseLevel(url.searchParams.get('level'));
    const uid = url.searchParams.get('user') ?? '';
    if (!lv || !/^[a-z]+-[a-z0-9-]{1,40}$/.test(uid)) return fail(400, 'bad-request', 'Unknown level or player.');
    const version = boardVersion(lv.map);
    const raw = await store.get(keys(lv.level, version).replay(uid));
    if (!raw) return fail(404, 'not-found', 'That replay isn’t on the board any more.');
    return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', ...CORS } });
  }

  async function submit(req: Request): Promise<Response> {
    const user = await userFor(req);
    if (!user) return fail(401, 'signed-out', 'Sign in again to post times.');
    if (await store.get(`ban:${user.id}`)) return fail(403, 'banned', 'This account can’t post times.');
    if ((await store.incr(`rl:${user.id}`, 60)) > SUBMITS_PER_MINUTE) return fail(429, 'slow-down', 'Too many submissions. Try again in a minute.');
    const text = await req.text();
    if (text.length > MAX_BODY) return fail(413, 'too-big', 'This replay is too long to post.');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(400, 'bad-replay', 'That isn’t a replay.');
    }
    const r = unpackReplay(body);
    if (!r) return fail(400, 'bad-replay', 'That isn’t a replay.');
    const lv = parseLevel(`${r.map}:${r.mode}`)!;
    const version = boardVersion(lv.map);
    if (`${r.physics}-${r.mapHash}` !== version) return fail(409, 'outdated', 'This run was played on an older version of the game, so it can’t go on the current board.');
    if (r.ticks > MAX_RUN_TICKS) return fail(422, 'too-long', 'Runs over 10 hours can’t be posted.');
    if (r.inputs.some(i => i.kind === 'teleport')) return fail(422, 'teleport', 'Runs that used debug teleports can’t be posted.');
    if (r.inputs.length && r.inputs[r.inputs.length - 1].tick > r.ticks) return fail(422, 'bad-replay', 'That replay doesn’t add up.');

    const k = keys(lv.level, version);
    const rank = async () => ((await store.zrank(k.board, user.id)) ?? -1) + 1;
    // Cheap checks first: is it a personal best, and would it make the top 100?
    const current = await store.zscore(k.board, user.id);
    if (current !== null && Math.floor(current) <= r.ticks) return json(200, { ok: true, improved: false, rank: await rank(), ticks: Math.floor(current) });
    if (current === null && (await store.zcard(k.board)) >= BOARD_SIZE) {
      const [last] = await store.zrange(k.board, BOARD_SIZE - 1, BOARD_SIZE - 1);
      if (last && Math.floor(last.score) <= r.ticks) return json(200, { ok: true, improved: false, rank: null, cutoff: Math.floor(last.score) });
    }

    const check = verifyReplay(r);
    if (!check.won || check.ticks !== r.ticks) return fail(422, 'did-not-win', 'That replay doesn’t win the level in that time, so it wasn’t posted.');

    const stats = check.state.stats;
    const entry: Entry = { name: user.name, url: user.url, ticks: r.ticks, falls: stats.falls, grapples: stats.grapples, date: new Date(now()).toISOString() };
    if (r.wheels) entry.wheels = r.wheels;
    await store.set(k.entry(user.id), JSON.stringify(entry));
    await store.set(k.replay(user.id), JSON.stringify(packReplay({ ...r, date: entry.date, stats: { ...stats } })));
    await store.zadd(k.board, r.ticks + (now() - EPOCH) / 1e13, user.id);
    // keep the board at 100: whoever got pushed off loses their entry and replay
    const off = await store.zrange(k.board, BOARD_SIZE, -1);
    if (off.length) {
      await store.zrem(k.board, ...off.map(o => o.member));
      await store.del(...off.flatMap(o => [k.entry(o.member), k.replay(o.member)]));
    }
    const place = await rank();
    return json(200, { ok: true, improved: true, rank: place || null, ticks: r.ticks });
  }

  async function adminRemove(url: URL, req: Request): Promise<Response> {
    if (!cfg.adminToken || req.headers.get('Authorization') !== `Bearer ${cfg.adminToken}`) return fail(404, 'not-found', 'No such endpoint.');
    const lv = parseLevel(url.searchParams.get('level'));
    const uid = url.searchParams.get('user') ?? '';
    if (!uid) return fail(400, 'bad-request', 'Which player?');
    if (lv) {
      const k = keys(lv.level, boardVersion(lv.map));
      await store.zrem(k.board, uid);
      await store.del(k.entry(uid), k.replay(uid));
    }
    if (url.searchParams.get('ban') === '1') await store.set(`ban:${uid}`, '1');
    return json(200, { ok: true });
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (req.method === 'GET') {
        if (path === '/api/health') return json(200, { ok: true, signIn: !!cfg.itch || !!cfg.devLogin, boards: Object.fromEntries((Object.keys(MAPS) as MapId[]).map(m => [m, boardVersion(m)])) });
        if (path === '/api/auth/start') return await authStart(url);
        if (path === '/api/auth/callback') return await authCallback(url);
        if (path === '/api/auth/poll') {
          const lid = url.searchParams.get('lid');
          if (!isLoginId(lid)) return fail(400, 'bad-request', 'Bad login id.');
          const done = await store.take(`login:${lid}`);
          return json(200, done ? { status: 'done', ...JSON.parse(done) } : { status: 'pending' });
        }
        if (path === '/api/me') {
          const user = await userFor(req);
          return user ? json(200, { user }) : fail(401, 'signed-out', 'Not signed in.');
        }
        if (path === '/api/board') return await board(url, req);
        if (path === '/api/replay') return await replay(url);
      }
      if (req.method === 'POST') {
        if (path === '/api/auth/dev-login') return await devLogin(req);
        if (path === '/api/auth/logout') {
          const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '');
          if (m) await store.del(`sess:${m[1]}`);
          return json(200, { ok: true });
        }
        if (path === '/api/submit') return await submit(req);
        if (path === '/api/admin/remove') return await adminRemove(url, req);
      }
      return fail(404, 'not-found', 'No such endpoint.');
    } catch (e) {
      console.error(e);
      return fail(500, 'server-error', 'Something went wrong on the server. Try again later.');
    }
  };
}
