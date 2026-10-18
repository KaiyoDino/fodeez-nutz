// The few key-value and sorted-set operations the leaderboard needs. Two implementations:
// an in-memory one (tests and the dev server) and Upstash Redis over its REST API (production),
// which needs no client library, only fetch.

export interface Scored {
  member: string;
  score: number;
}

export interface Store {
  get(key: string): Promise<string | null>;
  /** Returns false when `nx` is set and the key already exists. `ttl` is in seconds. */
  set(key: string, value: string, opts?: { ttl?: number; nx?: boolean }): Promise<boolean>;
  /** Read and delete in one step (for one-time values). */
  take(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<void>;
  mget(keys: string[]): Promise<(string | null)[]>;
  /** Add 1 and return the new count. The key expires `ttl` seconds after it's first created. */
  incr(key: string, ttl: number): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zscore(key: string, member: string): Promise<number | null>;
  /** 0-based position from the lowest score, or null. */
  zrank(key: string, member: string): Promise<number | null>;
  /** Members from position `start` to `stop` inclusive (-1 is the last), lowest score first. */
  zrange(key: string, start: number, stop: number): Promise<Scored[]>;
  zrem(key: string, ...members: string[]): Promise<void>;
  zcard(key: string): Promise<number>;
}

export class MemoryStore implements Store {
  private kv = new Map<string, { value: string; expires: number }>();
  private zsets = new Map<string, Map<string, number>>();
  now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private live(key: string): string | null {
    const e = this.kv.get(key);
    if (!e) return null;
    if (e.expires && e.expires <= this.now()) {
      this.kv.delete(key);
      return null;
    }
    return e.value;
  }

  private sorted(key: string): Scored[] {
    const z = this.zsets.get(key);
    if (!z) return [];
    return [...z].map(([member, score]) => ({ member, score })).sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));
  }

  async get(key: string) {
    return this.live(key);
  }

  async set(key: string, value: string, opts: { ttl?: number; nx?: boolean } = {}) {
    if (opts.nx && this.live(key) !== null) return false;
    this.kv.set(key, { value, expires: opts.ttl ? this.now() + opts.ttl * 1000 : 0 });
    return true;
  }

  async take(key: string) {
    const v = this.live(key);
    this.kv.delete(key);
    return v;
  }

  async del(...keys: string[]) {
    for (const k of keys) {
      this.kv.delete(k);
      this.zsets.delete(k);
    }
  }

  async mget(keys: string[]) {
    return keys.map(k => this.live(k));
  }

  async incr(key: string, ttl: number) {
    const v = Number(this.live(key) ?? 0) + 1;
    const e = this.kv.get(key);
    this.kv.set(key, { value: String(v), expires: e?.expires || this.now() + ttl * 1000 });
    return v;
  }

  async zadd(key: string, score: number, member: string) {
    let z = this.zsets.get(key);
    if (!z) this.zsets.set(key, (z = new Map()));
    z.set(member, score);
  }

  async zscore(key: string, member: string) {
    return this.zsets.get(key)?.get(member) ?? null;
  }

  async zrank(key: string, member: string) {
    const i = this.sorted(key).findIndex(s => s.member === member);
    return i < 0 ? null : i;
  }

  async zrange(key: string, start: number, stop: number) {
    const all = this.sorted(key);
    return all.slice(start, stop < 0 ? all.length + stop + 1 : stop + 1);
  }

  async zrem(key: string, ...members: string[]) {
    const z = this.zsets.get(key);
    for (const m of members) z?.delete(m);
  }

  async zcard(key: string) {
    return this.zsets.get(key)?.size ?? 0;
  }
}

/** Upstash Redis through its REST API (https://upstash.com/docs/redis/features/restapi). */
export class UpstashStore implements Store {
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
  }

  private async cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(String)),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
    if (!res.ok || body.error) throw new Error(`redis ${args[0]}: ${body.error ?? res.status}`);
    return body.result as T;
  }

  async get(key: string) {
    return this.cmd<string | null>('GET', key);
  }

  async set(key: string, value: string, opts: { ttl?: number; nx?: boolean } = {}) {
    const args: (string | number)[] = ['SET', key, value];
    if (opts.ttl) args.push('EX', opts.ttl);
    if (opts.nx) args.push('NX');
    return (await this.cmd<string | null>(...args)) === 'OK';
  }

  async take(key: string) {
    return this.cmd<string | null>('GETDEL', key);
  }

  async del(...keys: string[]) {
    if (keys.length) await this.cmd('DEL', ...keys);
  }

  async mget(keys: string[]) {
    return keys.length ? this.cmd<(string | null)[]>('MGET', ...keys) : [];
  }

  async incr(key: string, ttl: number) {
    const v = await this.cmd<number>('INCR', key);
    if (v === 1) await this.cmd('EXPIRE', key, ttl);
    return v;
  }

  async zadd(key: string, score: number, member: string) {
    await this.cmd('ZADD', key, score, member);
  }

  async zscore(key: string, member: string) {
    const v = await this.cmd<string | null>('ZSCORE', key, member);
    return v === null ? null : Number(v);
  }

  async zrank(key: string, member: string) {
    return this.cmd<number | null>('ZRANK', key, member);
  }

  async zrange(key: string, start: number, stop: number) {
    const flat = await this.cmd<string[]>('ZRANGE', key, start, stop, 'WITHSCORES');
    const out: Scored[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push({ member: flat[i], score: Number(flat[i + 1]) });
    return out;
  }

  async zrem(key: string, ...members: string[]) {
    if (members.length) await this.cmd('ZREM', key, ...members);
  }

  async zcard(key: string) {
    return this.cmd<number>('ZCARD', key);
  }
}
