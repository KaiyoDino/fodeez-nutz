// The leaderboard API on the dev server (npm run dev): /api/* runs server/api.ts against an
// in-memory store, with a "type any name" sign-in instead of itch.io. Everything resets when
// the dev server restarts. Set ITCH_CLIENT_ID (and an Upstash URL/token) to try the real thing.
// The server code is loaded through Vite (ssrLoadModule) so the config itself stays small.
import type { Plugin } from 'vite';

type Handler = (req: Request) => Promise<Response>;

export function apiPlugin(): Plugin {
  return {
    name: 'fodeez-leaderboard-api',
    apply: 'serve',
    configureServer(server) {
      let api: Promise<{ handle: Handler; adapter: typeof import('../server/node-adapter.ts') }> | null = null;
      const load = async () => {
        const env = process.env;
        const { createApi } = (await server.ssrLoadModule('/server/api.ts')) as typeof import('../server/api.ts');
        const { MemoryStore, UpstashStore } = (await server.ssrLoadModule('/server/store.ts')) as typeof import('../server/store.ts');
        const adapter = (await server.ssrLoadModule('/server/node-adapter.ts')) as typeof import('../server/node-adapter.ts');
        const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
        const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
        const handle = createApi({
          store: url && token ? new UpstashStore(url, token) : new MemoryStore(),
          itch: env.ITCH_CLIENT_ID ? { clientId: env.ITCH_CLIENT_ID, redirectUri: env.ITCH_REDIRECT_URI || undefined } : null,
          devLogin: !env.ITCH_CLIENT_ID,
          adminToken: env.ADMIN_TOKEN || 'dev-admin',
        });
        return { handle, adapter };
      };
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        (api ??= load())
          .then(async ({ handle, adapter }) => adapter.sendResponse(res, await handle(await adapter.toRequest(req, adapter.originOf(req)))))
          .catch(next);
      });
    },
  };
}
