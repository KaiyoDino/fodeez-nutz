// Runs the fetch-style API (api.ts) behind Node's http request/response objects, for Vercel
// and the Vite dev server.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BODY } from './api';

/** Hop-by-hop and length headers, which don't carry over to a rebuilt Request. */
const SKIP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade']);

export async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !SKIP.has(k)) headers.set(k, v);
  const method = req.method ?? 'GET';
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY + 1024) break;
      chunks.push(chunk as Buffer);
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  return new Request(new URL(req.url ?? '/', origin), { method, headers, body });
}

export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * The path a request was really for. On Vercel every /api/* path goes to one function (the
 * Hobby plan allows 12 per deployment), through a rewrite that passes the path as `__route`.
 * If the function sees the rewritten URL, this puts the original path back.
 */
export function restoreRoute(url: string): string {
  const u = new URL(url, 'http://x');
  const route = u.searchParams.get('__route');
  if (route === null) return url;
  u.searchParams.delete('__route');
  if (u.pathname === '/api' || u.pathname === '/api/' || u.pathname === '/api/index') u.pathname = `/api/${route.replace(/^\/+/, '')}`;
  return u.pathname + u.search;
}

/** The public origin of a request, from the proxy headers Vercel (and most hosts) set. */
export function originOf(req: IncomingMessage): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}
