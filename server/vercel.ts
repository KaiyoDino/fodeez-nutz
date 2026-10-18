// The Vercel Function entry point. tools/build-vercel.mjs bundles this (with the simulation)
// into .vercel/output/functions/api/*.func.
//
// Environment variables (Vercel project settings):
//   KV_REST_API_URL, KV_REST_API_TOKEN   Upstash Redis (added for you when you connect an Upstash
//                                        database from the Vercel Marketplace; the
//                                        UPSTASH_REDIS_REST_URL / _TOKEN names work too)
//   ITCH_CLIENT_ID                       the itch.io OAuth app's client ID
//   ITCH_REDIRECT_URI                    optional; default https://<this site>/api/auth/callback
//   ADMIN_TOKEN                          optional; enables /api/admin/remove
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApi } from './api';
import { originOf, sendResponse, toRequest } from './node-adapter';
import { UpstashStore } from './store';

const env = process.env;
const redisUrl = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
const redisToken = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;

const api =
  redisUrl && redisToken
    ? createApi({
        store: new UpstashStore(redisUrl, redisToken),
        itch: env.ITCH_CLIENT_ID ? { clientId: env.ITCH_CLIENT_ID, redirectUri: env.ITCH_REDIRECT_URI || undefined } : null,
        adminToken: env.ADMIN_TOKEN || undefined,
      })
    : null;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!api) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify({ error: 'not-configured', message: 'The leaderboard database isn’t connected yet.' }));
    return;
  }
  await sendResponse(res, await api(await toRequest(req, originOf(req))));
}
