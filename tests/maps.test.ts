// Player-made maps: the map format's checks, and the server's community maps (upload only
// with a winning run, ratings, difficulty from other players' first wins).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../server/api';
import { MemoryStore } from '../server/store';
import { checkDoc, cleanDoc, docFromMap, docToMap, newDoc, type MapDoc } from '../src/sim/custom-map';
import { MAPS, registerMap } from '../src/sim/level';
import { packReplay, verifyReplay, type Replay } from '../src/sim/replay';

const fixture = (mode: 'newage' | 'original'): Replay => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', `starter-${mode}.json`), 'utf8')) as Replay;
const starter = (mode: 'newage' | 'original', name = 'Starter'): MapDoc => newDoc(name, mode);

describe('the map format', () => {
  it('accepts the starter map, and maps made from the built-in ones', () => {
    expect(checkDoc(starter('newage'))).toBeNull();
    for (const map of [MAPS.tower, MAPS.crane]) for (const mode of ['original', 'newage'] as const) expect(checkDoc(docFromMap(map, mode, 'Copy'))).toBeNull();
  });

  it('turns down maps the map maker could not have made', () => {
    const d = starter('newage');
    expect(checkDoc({ ...d, name: '   ' })).toMatch(/name/);
    expect(checkDoc({ ...d, platforms: d.platforms.filter(p => p.kind !== 'goal') })).toMatch(/goal/);
    expect(checkDoc({ ...d, world: { w: 100, h: 100 } })).toMatch(/wide/);
    expect(checkDoc({ ...d, platforms: [...d.platforms, { ...d.platforms[5], role: 'trapdoor' }] })).toMatch(/trick/);
    expect(checkDoc({ ...d, platforms: [...d.platforms, { ...d.platforms[5], onlyIn: 'original' }] })).toMatch(/one mode/);
    expect(checkDoc({ ...d, platforms: [...d.platforms, { ...d.platforms[4], w: 40 }] })).toMatch(/25/);
    expect(checkDoc({ ...d, platforms: Array.from({ length: 401 }, () => d.platforms[0]) })).toMatch(/400/);
    expect(checkDoc({ ...d, start: { x: -50, y: 0 } })).toMatch(/start/);
    expect(checkDoc({ ...d, platforms: [...d.platforms, { ...d.platforms[5], x: Number.NaN }] })).toMatch(/number/);
  });

  it('the bot’s runs on the starter map still win', () => {
    for (const mode of ['newage', 'original'] as const) {
      registerMap(docToMap('draft-starter', starter(mode)));
      expect(verifyReplay(fixture(mode)).won).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- server

let api: (req: Request) => Promise<Response>;
const ORIGIN = 'https://game.example';

beforeEach(() => {
  api = createApi({ store: new MemoryStore(), itch: null, devLogin: true, adminToken: 'admin' });
});

const get = (path: string, token?: string) => api(new Request(ORIGIN + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
const post = (path: string, body: unknown, token?: string) =>
  api(new Request(ORIGIN + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));

let lidCount = 0;
async function signIn(name: string): Promise<string> {
  const lid = (++lidCount).toString(16).padStart(32, '0');
  await api(new Request(`${ORIGIN}/api/auth/dev-login`, { method: 'POST', body: new URLSearchParams({ lid, name }) }));
  return ((await (await get(`/api/auth/poll?lid=${lid}`)).json()) as { token: string }).token;
}

/** Upload the starter map with the bot's winning run, as `token`. */
async function uploadStarter(token: string, mode: 'newage' | 'original' = 'newage', doc = starter(mode)) {
  return post('/api/maps/upload', { doc, replay: packReplay(fixture(mode)) }, token);
}

describe('community maps', () => {
  it('only takes a map with a winning run on exactly that map', async () => {
    const alice = await signIn('Alice');
    expect((await uploadStarter('')).status).toBe(401);
    // no run
    expect((await post('/api/maps/upload', { doc: starter('newage') }, alice)).status).toBe(400);
    // the map was changed after the run
    const moved = starter('newage');
    moved.platforms[moved.platforms.length - 1].x += 10;
    expect(await (await uploadStarter(alice, 'newage', moved)).json()).toMatchObject({ error: 'stale-run' });
    // won in the other mode
    expect((await post('/api/maps/upload', { doc: starter('newage'), replay: packReplay(fixture('original')) }, alice)).status).toBe(422);
    // a run that doesn't finish
    const r = fixture('newage');
    expect(await (await post('/api/maps/upload', { doc: starter('newage'), replay: packReplay({ ...r, inputs: r.inputs.slice(0, 4) }) }, alice)).json()).toMatchObject({ error: 'did-not-win' });
    // a broken map
    expect(await (await uploadStarter(alice, 'newage', { ...starter('newage'), platforms: starter('newage').platforms.slice(0, 4) })).json()).toMatchObject({ error: 'bad-map' });

    const ok = await (await uploadStarter(alice)).json();
    expect(ok).toMatchObject({ ok: true, map: { name: 'Starter', mode: 'newage', creator: { name: 'Alice' }, creatorTicks: r.ticks, clears: 0, rating: { avg: null, count: 0 } } });
    expect(ok.map.id).toMatch(/^c-[a-z0-9]{10}$/);
    // the same layout again is a duplicate, whatever it's called
    expect((await uploadStarter(alice, 'newage', starter('newage', 'Copy'))).status).toBe(409);
    // the creator's run is on the map's board
    const board = await (await get(`/api/board?level=${ok.map.id}:newage`)).json();
    expect(board.entries[0]).toMatchObject({ rank: 1, user: { name: 'Alice' }, ticks: r.ticks });
  });

  it('lists, rates, and works out difficulty from other players’ first wins', async () => {
    const alice = await signIn('Alice');
    const bob = await signIn('Bob');
    const carol = await signIn('Carol');
    const { map } = await (await uploadStarter(alice)).json();
    const { map: map2 } = await (await uploadStarter(alice, 'original')).json();
    const id = map.id as string;

    // listing and loading
    const list = await (await get('/api/maps?sort=new')).json();
    expect(list.maps.map((m: { id: string }) => m.id)).toEqual([map2.id, id]);
    const got = await (await get(`/api/maps/get?id=${id}`, bob)).json();
    expect(cleanDoc(got.doc)).toEqual(cleanDoc(starter('newage')));
    expect(got.yourRating).toBeNull();

    // ratings: not your own map, 1 to 5 stars, one per player (changing it replaces it)
    expect((await post('/api/maps/rate', { id, stars: 5 }, alice)).status).toBe(403);
    expect((await post('/api/maps/rate', { id, stars: 6 }, bob)).status).toBe(400);
    expect(await (await post('/api/maps/rate', { id, stars: 4 }, bob)).json()).toMatchObject({ rating: { avg: 4, count: 1 } });
    expect(await (await post('/api/maps/rate', { id, stars: 2 }, bob)).json()).toMatchObject({ rating: { avg: 2, count: 1 } });
    expect(await (await post('/api/maps/rate', { id, stars: 5 }, carol)).json()).toMatchObject({ rating: { avg: 3.5, count: 2 } });
    const top = await (await get('/api/maps?sort=top')).json();
    expect(top.maps[0].id).toBe(id); // 3.5 from two ratings beats no ratings

    // difficulty: other players' first wins (the creator's don't count)
    const run = (ticks?: number) => {
      const r = fixture('newage');
      return packReplay({ ...r, map: id, ...(ticks ? { ticks } : {}) });
    };
    expect(await (await post('/api/submit', run(), alice)).json()).toMatchObject({ ok: true, improved: false });
    expect(await (await post('/api/submit', run(), bob)).json()).toMatchObject({ ok: true });
    let s = (await (await get(`/api/maps/get?id=${id}`)).json()).map;
    expect(s).toMatchObject({ clears: 1, avgTicks: fixture('newage').ticks });
    // a second win by the same player doesn't count again
    await post('/api/submit', run(), bob);
    s = (await (await get(`/api/maps/get?id=${id}`)).json()).map;
    expect(s.clears).toBe(1);
    // a fake time is still refused
    expect((await post('/api/submit', run(fixture('newage').ticks - 30), carol)).status).toBe(422);
    s = (await (await get(`/api/maps/get?id=${id}`)).json()).map;
    expect(s.clears).toBe(1);
    const byClears = await (await get('/api/maps?sort=clears')).json();
    expect(byClears.maps[0].id).toBe(id);
  });

  it('lets the creator (and only the creator) delete a map', async () => {
    const alice = await signIn('Alice');
    const bob = await signIn('Bob');
    const { map } = await (await uploadStarter(alice)).json();
    expect((await post(`/api/maps/delete?id=${map.id}`, {}, bob)).status).toBe(403);
    expect((await post(`/api/maps/delete?id=${map.id}`, {}, alice)).status).toBe(200);
    expect((await get(`/api/maps/get?id=${map.id}`)).status).toBe(404);
    expect(await (await get('/api/maps?sort=new')).json()).toMatchObject({ maps: [] });
    // and it can be uploaded again
    expect((await uploadStarter(alice)).status).toBe(200);
  });
});
