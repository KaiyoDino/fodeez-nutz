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
//
// Community maps (players' own maps, with ratings and difficulty) are in maps.ts.

import { isCommunityMapId } from '../src/sim/custom-map';
import { isBuiltinMap, MAP_IDS, type MapId } from '../src/sim/level';
import { unpackReplay, verifyReplay } from '../src/sim/replay';
import type { Mode } from '../src/sim/types';
import { BOARD_SIZE, boardKeys as keys, boardVersion, CORS, fail, json, MODES, putOnBoard, type Entry, type PublicUser } from './common';
import { createMaps, MAX_COMMUNITY_TICKS } from './maps';
import type { Store } from './store';

export { BOARD_SIZE, boardVersion, type PublicUser } from './common';

/** Longest run the server will check on a built-in map: 10 hours of play (about a minute of CPU). */
export const MAX_RUN_TICKS = 10 * 60 * 60 * 60;
/** Biggest submission accepted, in bytes of JSON. */
export const MAX_BODY = 3_000_000;
const SESSION_TTL = 60 * 60 * 24 * 365 * 2;
const LOGIN_TTL = 15 * 60;
const SUBMITS_PER_MINUTE = 12;

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

/** "tower:newage" and friends (built-in maps only). Returns null for anything else. */
export function parseLevel(level: string | null): { map: MapId; mode: Mode; level: string } | null {
  const [map, mode] = (level ?? '').split(':');
  if (!isBuiltinMap(map) || !MODES.includes(mode as Mode)) return null;
  return { map, mode: mode as Mode, level: `${map}:${mode}` };
}

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
  const maps = createMaps({ store, now, userFor: req => userFor(req), adminToken: cfg.adminToken });

  /** A built-in level, or a community map in its one mode (loaded so runs on it can be checked). */
  async function levelOf(level: string | null): Promise<{ map: MapId; mode: Mode; level: string; community: boolean } | null> {
    const built = parseLevel(level);
    if (built) return { ...built, community: false };
    const [map, mode] = (level ?? '').split(':');
    if (!isCommunityMapId(map)) return null;
    const rec = await maps.load(map);
    if (!rec || rec.doc.mode !== mode) return null;
    return { map, mode: rec.doc.mode, level: `${map}:${mode}`, community: true };
  }

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
    const lv = await levelOf(url.searchParams.get('level'));
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
    const lv = await levelOf(url.searchParams.get('level'));
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
    // a community map has to be loaded before its runs can be read
    const mapId = (body as { map?: unknown })?.map;
    if (typeof mapId === 'string' && isCommunityMapId(mapId) && !(await maps.load(mapId))) return fail(404, 'no-map', 'That map has been deleted, so runs on it can’t be posted.');
    const r = unpackReplay(body);
    if (!r) return fail(400, 'bad-replay', 'That isn’t a replay.');
    const lv = await levelOf(`${r.map}:${r.mode}`);
    if (!lv) return fail(400, 'bad-level', 'That map isn’t played in that mode.');
    const version = boardVersion(lv.map);
    if (`${r.physics}-${r.mapHash}` !== version) return fail(409, 'outdated', 'This run was played on an older version of the game, so it can’t go on the current board.');
    const maxTicks = lv.community ? MAX_COMMUNITY_TICKS : MAX_RUN_TICKS;
    if (r.ticks > maxTicks) return fail(422, 'too-long', `Runs over ${maxTicks / 216000} hours can’t be posted.`);
    if (r.inputs.some(i => i.kind === 'teleport')) return fail(422, 'teleport', 'Runs that used debug teleports can’t be posted.');
    if (r.inputs.length && r.inputs[r.inputs.length - 1].tick > r.ticks) return fail(422, 'bad-replay', 'That replay doesn’t add up.');

    const k = keys(lv.level, version);
    const rank = async () => ((await store.zrank(k.board, user.id)) ?? -1) + 1;
    // A player's first win on a community map counts towards its difficulty, top 100 or not.
    const firstClear = lv.community && (await maps.needsClear(lv.map, user));
    // Cheap checks first: is it a personal best, and would it make the top 100?
    const current = await store.zscore(k.board, user.id);
    let notBetter: Record<string, unknown> | null = null;
    if (current !== null && Math.floor(current) <= r.ticks) notBetter = { ok: true, improved: false, rank: await rank(), ticks: Math.floor(current) };
    else if (current === null && (await store.zcard(k.board)) >= BOARD_SIZE) {
      const [last] = await store.zrange(k.board, BOARD_SIZE - 1, BOARD_SIZE - 1);
      if (last && Math.floor(last.score) <= r.ticks) notBetter = { ok: true, improved: false, rank: null, cutoff: Math.floor(last.score) };
    }
    if (notBetter && !firstClear) return json(200, notBetter);

    const check = verifyReplay(r);
    if (!check.won || check.ticks !== r.ticks) return fail(422, 'did-not-win', 'That replay doesn’t win the level in that time, so it wasn’t posted.');
    if (firstClear) await maps.countClear(lv.map, user, r.ticks);
    if (notBetter) return json(200, notBetter);

    const place = await putOnBoard(store, lv.level, version, user, r, check.state.stats, now());
    return json(200, { ok: true, improved: true, rank: place, ticks: r.ticks });
  }

  async function adminRemove(url: URL, req: Request): Promise<Response> {
    if (!cfg.adminToken || req.headers.get('Authorization') !== `Bearer ${cfg.adminToken}`) return fail(404, 'not-found', 'No such endpoint.');
    const lv = await levelOf(url.searchParams.get('level'));
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
        if (path === '/api/health') return json(200, { ok: true, signIn: !!cfg.itch || !!cfg.devLogin, boards: Object.fromEntries(MAP_IDS.map(m => [m, boardVersion(m)])) });
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
        if (path === '/api/maps') return await maps.list(url);
        if (path === '/api/maps/get') return await maps.get(url, req);
        if (path === '/api/maps/mine') return await maps.mine(req);
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
        if (path === '/api/maps/upload') return await maps.upload(req);
        if (path === '/api/maps/rate') return await maps.rate(req);
        if (path === '/api/maps/delete') return await maps.remove(url, req);
      }
      return fail(404, 'not-found', 'No such endpoint.');
    } catch (e) {
      console.error(e);
      return fail(500, 'server-error', 'Something went wrong on the server. Try again later.');
    }
  };
}
