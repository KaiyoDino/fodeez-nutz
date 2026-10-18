// Community maps: players upload maps they made in the map maker, other players play and
// rate them, and each map's difficulty comes from how long other players took to beat it.
//
// A map can only be uploaded together with a winning run by its creator, which the server
// replays on the uploaded map, so every community map is known to be beatable. Maps can't be
// changed once uploaded (a run is only valid on the exact layout it was played on); the
// creator can delete one and upload a new version.
//
// Storage (see store.ts):
//   m:<id>         summary (name, mode, creator, ...)      md:<id>   the map itself
//   ms:<id>:rsum / rcnt / clears / tsum                     rating and first-clear counters
//   mr:<id>:<uid>  a player's rating (1-5)                  mc:<id>:<uid>  their first clear was counted
//   mh:<mode>:<hash>  which map has this exact layout in this mode (no duplicate uploads)
//   mi:new / mi:top / mi:clears   indexes for browsing      mu:<uid>  a player's uploads

import { checkDoc, cleanDoc, docToMap, isCommunityMapId, type MapDoc } from '../src/sim/custom-map';
import { registerMap, unregisterMap } from '../src/sim/level';
import { mapHash, PHYSICS_VERSION, unpackReplay, verifyReplay } from '../src/sim/replay';
import type { Mode } from '../src/sim/types';
import { boardKeys, boardVersion, fail, json, putOnBoard, type PublicUser } from './common';
import type { Store } from './store';

/** Longest run checked on a community map: 4 hours (a 400-piece map costs ~0.6 s of CPU per minute of play). */
export const MAX_COMMUNITY_TICKS = 4 * 60 * 60 * 60;
const UPLOADS_PER_DAY = 20;
const PAGE = 24;
/** Ratings are ranked as if every map started with two 3-star ratings, so one 5-star vote doesn't top the list. */
const PRIOR_COUNT = 2;
const PRIOR_MEAN = 3;

interface StoredMap {
  id: string;
  name: string;
  mode: Mode;
  theme: MapDoc['theme'];
  creator: PublicUser;
  created: string;
  pieces: number;
  hash: string;
  /** The creator's winning time, from the run they uploaded it with. */
  creatorTicks: number;
}

export interface MapSummary extends StoredMap {
  rating: { avg: number | null; count: number };
  /** How many other players have beaten it, and their average time on that first win. */
  clears: number;
  avgTicks: number | null;
}

export type SortBy = 'top' | 'new' | 'clears';
const INDEX: Record<SortBy, string> = { top: 'mi:top', new: 'mi:new', clears: 'mi:clears' };
const STATS = ['rsum', 'rcnt', 'clears', 'tsum'] as const;

export interface MapsContext {
  store: Store;
  now: () => number;
  userFor(req: Request): Promise<PublicUser | null>;
  adminToken?: string;
}

export function createMaps(ctx: MapsContext) {
  const { store, now } = ctx;
  /** Maps loaded on this server instance (they never change, so they can stay). */
  const cache = new Map<string, { info: StoredMap; doc: MapDoc }>();

  function randomId(): string {
    const a = crypto.getRandomValues(new Uint8Array(10));
    return 'c-' + [...a].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
  }

  /** Load a community map and make it playable here (for checking runs on it). */
  async function load(id: string): Promise<{ info: StoredMap; doc: MapDoc } | null> {
    if (!isCommunityMapId(id)) return null;
    const hit = cache.get(id);
    if (hit) return hit;
    const [info, doc] = await store.mget([`m:${id}`, `md:${id}`]);
    if (!info || !doc) return null;
    const rec = { info: JSON.parse(info) as StoredMap, doc: JSON.parse(doc) as MapDoc };
    registerMap(docToMap(id, rec.doc, rec.info.creator.name));
    cache.set(id, rec);
    return rec;
  }

  async function summaries(infos: StoredMap[]): Promise<MapSummary[]> {
    const raw = await store.mget(infos.flatMap(m => STATS.map(s => `ms:${m.id}:${s}`)));
    return infos.map((m, i) => {
      const [rsum, rcnt, clears, tsum] = STATS.map((_, j) => Number(raw[i * STATS.length + j] ?? 0));
      return { ...m, rating: { avg: rcnt ? Math.round((rsum / rcnt) * 10) / 10 : null, count: rcnt }, clears, avgTicks: clears ? Math.round(tsum / clears) : null };
    });
  }

  async function list(url: URL): Promise<Response> {
    const sort = (url.searchParams.get('sort') ?? 'top') as SortBy;
    if (!(sort in INDEX)) return fail(400, 'bad-request', 'Unknown order.');
    const offset = Math.max(0, Math.min(10_000, Number(url.searchParams.get('offset')) || 0));
    const ids = await store.zrange(INDEX[sort], offset, offset + PAGE);
    const page = ids.slice(0, PAGE);
    const raw = await store.mget(page.map(i => `m:${i.member}`));
    const infos = raw.flatMap(r => (r ? [JSON.parse(r) as StoredMap] : []));
    return json(200, { sort, offset, maps: await summaries(infos), more: ids.length > PAGE });
  }

  async function mine(req: Request): Promise<Response> {
    const user = await ctx.userFor(req);
    if (!user) return fail(401, 'signed-out', 'Sign in to see your maps.');
    const ids = await store.zrange(`mu:${user.id}`, 0, -1);
    const raw = await store.mget(ids.map(i => `m:${i.member}`));
    return json(200, { maps: await summaries(raw.flatMap(r => (r ? [JSON.parse(r) as StoredMap] : []))) });
  }

  async function get(url: URL, req: Request): Promise<Response> {
    const rec = await load(url.searchParams.get('id') ?? '');
    if (!rec) return fail(404, 'not-found', 'That map isn’t there any more.');
    const [summary] = await summaries([rec.info]);
    const user = await ctx.userFor(req);
    const yourRating = user ? Number((await store.get(`mr:${rec.info.id}:${user.id}`)) ?? 0) || null : null;
    return json(200, { map: summary, doc: rec.doc, yourRating, version: boardVersion(rec.info.id) });
  }

  async function upload(req: Request): Promise<Response> {
    const user = await ctx.userFor(req);
    if (!user) return fail(401, 'signed-out', 'Sign in to upload maps.');
    if (await store.get(`ban:${user.id}`)) return fail(403, 'banned', 'This account can’t upload maps.');
    let body: { doc?: unknown; replay?: unknown };
    try {
      body = JSON.parse(await req.text()) as typeof body;
    } catch {
      return fail(400, 'bad-request', 'That isn’t a map.');
    }
    const problem = checkDoc(body.doc);
    if (problem) return fail(400, 'bad-map', problem);
    const doc = cleanDoc(body.doc as MapDoc);
    if ((await store.incr(`mrl:${user.id}`, 60 * 60 * 24)) > UPLOADS_PER_DAY) return fail(429, 'slow-down', `You can upload ${UPLOADS_PER_DAY} maps a day. Try again tomorrow.`);

    // the creator's winning run has to win on exactly this map
    const id = randomId();
    const def = docToMap(id, doc, user.name);
    const hash = mapHash(def);
    const dupe = await store.get(`mh:${doc.mode}:${hash}`);
    if (dupe && (await store.get(`m:${dupe}`))) return fail(409, 'duplicate', 'This exact map has been uploaded already.');
    registerMap(def);
    const packed = body.replay && typeof body.replay === 'object' ? { ...(body.replay as object), map: id } : null;
    const r = unpackReplay(packed);
    const reject = (status: number, error: string, message: string) => {
      unregisterMap(id);
      return fail(status, error, message);
    };
    if (!r) return reject(400, 'no-run', 'Beat your map first: the upload needs your winning run.');
    if (r.mode !== doc.mode) return reject(422, 'wrong-mode', `Beat the map in ${doc.mode === 'newage' ? 'New Age' : 'Original'}, the mode it’s set to.`);
    if (r.physics !== PHYSICS_VERSION || r.mapHash !== hash) return reject(422, 'stale-run', 'The map changed after your winning run. Beat it again, then upload.');
    if (r.ticks > MAX_COMMUNITY_TICKS) return reject(422, 'too-long', 'Your winning run has to be under 4 hours.');
    if (r.inputs.some(i => i.kind === 'teleport')) return reject(422, 'teleport', 'Runs that used debug teleports don’t count.');
    const check = verifyReplay(r);
    if (!check.won || check.ticks !== r.ticks) return reject(422, 'did-not-win', 'Your run doesn’t beat this map, so it can’t be uploaded. Beat it again, then upload.');

    const t = now();
    const info: StoredMap = { id, name: doc.name, mode: doc.mode, theme: doc.theme, creator: user, created: new Date(t).toISOString(), pieces: doc.platforms.length, hash, creatorTicks: r.ticks };
    if (!(await store.set(`m:${id}`, JSON.stringify(info), { nx: true }))) return reject(500, 'server-error', 'Something went wrong. Try uploading again.');
    await store.set(`md:${id}`, JSON.stringify(doc));
    await store.set(`mh:${doc.mode}:${hash}`, id);
    await store.zadd('mi:new', -t, id);
    await store.zadd('mi:top', -PRIOR_MEAN, id);
    await store.zadd('mi:clears', 0, id);
    await store.zadd(`mu:${user.id}`, t, id);
    cache.set(id, { info, doc });
    // the creator's run goes on the map's leaderboard too
    await putOnBoard(store, `${id}:${doc.mode}`, boardVersion(id), user, { ...r, by: 'player' }, check.state.stats, t);
    const [summary] = await summaries([info]);
    return json(200, { ok: true, map: summary });
  }

  async function rate(req: Request): Promise<Response> {
    const user = await ctx.userFor(req);
    if (!user) return fail(401, 'signed-out', 'Sign in to rate maps.');
    let body: { id?: unknown; stars?: unknown };
    try {
      body = JSON.parse(await req.text()) as typeof body;
    } catch {
      return fail(400, 'bad-request', 'Bad rating.');
    }
    const stars = body.stars;
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) return fail(400, 'bad-request', 'Ratings are 1 to 5 stars.');
    const rec = await load(String(body.id ?? ''));
    if (!rec) return fail(404, 'not-found', 'That map isn’t there any more.');
    if (rec.info.creator.id === user.id) return fail(403, 'own-map', 'You can’t rate your own map.');
    const id = rec.info.id;
    const before = Number((await store.get(`mr:${id}:${user.id}`)) ?? 0);
    await store.set(`mr:${id}:${user.id}`, String(stars));
    const rsum = await store.incrby(`ms:${id}:rsum`, stars - before);
    const rcnt = before ? Number((await store.get(`ms:${id}:rcnt`)) ?? 0) : await store.incrby(`ms:${id}:rcnt`, 1);
    await store.zadd('mi:top', -((rsum + PRIOR_MEAN * PRIOR_COUNT) / (rcnt + PRIOR_COUNT)), id);
    return json(200, { ok: true, rating: { avg: Math.round((rsum / rcnt) * 10) / 10, count: rcnt }, yourRating: stars });
  }

  async function remove(url: URL, req: Request): Promise<Response> {
    const rec = await load(url.searchParams.get('id') ?? '');
    if (!rec) return fail(404, 'not-found', 'That map isn’t there any more.');
    const user = await ctx.userFor(req);
    const admin = !!ctx.adminToken && req.headers.get('Authorization') === `Bearer ${ctx.adminToken}`;
    if (!admin && user?.id !== rec.info.creator.id) return fail(403, 'not-yours', 'Only the map’s creator can delete it.');
    const { id, hash, creator, mode } = rec.info;
    await store.del(`m:${id}`, `md:${id}`, `mh:${mode}:${hash}`, ...STATS.map(s => `ms:${id}:${s}`), boardKeys(`${id}:${mode}`, boardVersion(id)).board);
    for (const index of [...Object.values(INDEX), `mu:${creator.id}`]) await store.zrem(index, id);
    cache.delete(id);
    unregisterMap(id);
    return json(200, { ok: true });
  }

  /**
   * After a run on a community map has been checked: if it's this player's first win there
   * (and they didn't make the map), it counts towards the map's difficulty.
   */
  async function countClear(id: string, user: PublicUser, ticks: number): Promise<void> {
    const rec = await load(id);
    if (!rec || rec.info.creator.id === user.id) return;
    if (!(await store.set(`mc:${id}:${user.id}`, '1', { nx: true }))) return;
    const clears = await store.incrby(`ms:${id}:clears`, 1);
    await store.incrby(`ms:${id}:tsum`, ticks);
    await store.zadd('mi:clears', -clears, id);
  }

  /** Has this player's first win on the map been counted yet? (The creator's never is.) */
  async function needsClear(id: string, user: PublicUser): Promise<boolean> {
    const rec = await load(id);
    if (!rec || rec.info.creator.id === user.id) return false;
    return !(await store.get(`mc:${id}:${user.id}`));
  }

  return { load, list, mine, get, upload, rate, remove, countClear, needsClear };
}
