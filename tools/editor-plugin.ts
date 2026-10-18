// Dev-server endpoint for the level editor's Save button: POST /__editor/save with
// { map, platforms, spots, areas }. It checks the data, regenerates the editor's region of
// src/sim/maps/<map>.ts, and writes the file (Vite then reloads the game and the editor).
// Only active on `npm run dev`; nothing of this ends up in a build.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { regionSource, replaceRegion, validate, type Spots } from '../src/editor/codegen.ts';
import type { PlatformDef } from '../src/sim/map-types.ts';

export function editorPlugin(root: string): Plugin {
  return {
    name: 'fodeez-level-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editor/save', (req, res) => {
        const reply = (status: number, body: object) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        let raw = '';
        req.on('data', chunk => {
          raw += chunk;
          if (raw.length > 2_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const body = JSON.parse(raw) as { map: string; platforms: PlatformDef[]; spots: Spots; areas?: string[] };
            if (!/^[a-z0-9-]+$/.test(body.map)) return reply(400, { error: 'bad map id' });
            const file = join(root, 'src', 'sim', 'maps', `${body.map}.ts`);
            if (!existsSync(file)) return reply(404, { error: `no map file for ${body.map}` });
            const problem = validate(body.platforms, body.spots);
            if (problem) return reply(400, { error: problem });
            const areas = Array.isArray(body.areas) && body.areas.every(a => typeof a === 'string') ? body.areas : undefined;
            const text = readFileSync(file, 'utf8');
            writeFileSync(file, replaceRegion(text, regionSource({ areas }, body.platforms, body.spots)));
            reply(200, { ok: true });
          } catch (e) {
            reply(500, { error: String((e as Error).message ?? e) });
          }
        });
      });
    },
  };
}
