// Turns a map's editable data back into TypeScript source, for the level editor's Save.
// The map files keep everything the editor owns between two marker comments; the rest of
// the file (the header comment, the MapDef with its name, theme and so on) is left alone.

import type { MapDef, PlatformDef } from '../sim/map-types.ts';

export const REGION_START = '// <editor>';
export const REGION_END = '// </editor>';

export interface Spots {
  start: { x: number; y: number };
  goopReset: { x: number; y: number };
  teleports: { x: number; y: number }[];
}

const CALL: Record<PlatformDef['kind'], string> = { girder: 'g', target: 't', goop: 'goop', spring: 'spring', goal: 'goal' };
const IMPORT: Record<PlatformDef['kind'], string> = { girder: 'girder as g', target: 'target as t', goop: 'goop', spring: 'spring', goal: 'goal' };
const ORDER: PlatformDef['kind'][] = ['girder', 'goal', 'goop', 'spring', 'target'];

const num = (v: number): string => String(Math.round(v * 100) / 100);
const str = (v: string): string => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function extras(p: PlatformDef): string {
  const parts: string[] = [];
  if (p.mover) parts.push(`mover: { range: ${num(p.mover.range)}, speed: ${num(p.mover.speed)} }`);
  if (p.role) parts.push(`role: ${str(p.role)}`);
  if (p.onlyIn) parts.push(`onlyIn: ${str(p.onlyIn)}`);
  if (p.note) parts.push(`note: ${str(p.note)}`);
  return parts.length ? `, { ${parts.join(', ')} }` : '';
}

/** One platform as a constructor call, e.g. `g(1450, 5470, 260, 40, 1)`. */
export function platformCall(p: PlatformDef): string {
  const args = p.kind === 'target' ? [p.x, p.y, p.area] : [p.x, p.y, p.w, p.h, p.area];
  return `${CALL[p.kind]}(${args.map(num).join(', ')}${extras(p)})`;
}

const spot = (s: { x: number; y: number }) => `{ x: ${num(s.x)}, y: ${num(s.y)} }`;

/** The source that goes between the markers. */
export function regionSource(map: Pick<MapDef, 'areas'>, platforms: readonly PlatformDef[], spots: Spots): string {
  const kinds = ORDER.filter(k => platforms.some(p => p.kind === k));
  const lines: string[] = [];
  lines.push(`${REGION_START} From here to the end marker, this is rewritten by the level editor (npm run dev, then open /editor.html).`);
  lines.push(`import { ${[...kinds.map(k => IMPORT[k]), 'type MapDef', 'type PlatformDef'].join(', ')} } from '../map-types';`);
  lines.push('');
  lines.push('const platforms: PlatformDef[] = [');
  let area = -1;
  let onlyIn: string | undefined;
  platforms.forEach((p, i) => {
    if (p.area !== area || p.onlyIn !== onlyIn) {
      if (i > 0) lines.push('');
      const name = map.areas?.[p.area] ?? `Area ${p.area}`;
      lines.push(`  // ${p.area}. ${name}${p.onlyIn ? ` (${p.onlyIn === 'newage' ? 'New Age' : 'Original'} only)` : ''}`);
      area = p.area;
      onlyIn = p.onlyIn;
    }
    lines.push(`  ${platformCall(p)}, // ${i}`);
  });
  lines.push('];');
  lines.push('');
  lines.push('const spots = {');
  lines.push(`  start: ${spot(spots.start)},`);
  lines.push(`  goopReset: ${spot(spots.goopReset)},`);
  lines.push('  teleports: [');
  for (const t of spots.teleports) lines.push(`    ${spot(t)},`);
  lines.push('  ],');
  lines.push('};');
  lines.push(REGION_END);
  return lines.join('\n');
}

/** Replace the editor's region in a map file. Throws if the markers are missing. */
export function replaceRegion(file: string, region: string): string {
  const a = file.indexOf(REGION_START);
  const b = file.indexOf(REGION_END, a);
  if (a < 0 || b < a) throw new Error('map file has no editor region');
  return file.slice(0, a) + region + file.slice(b + REGION_END.length);
}

const KINDS = new Set(['girder', 'target', 'goop', 'spring', 'goal']);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Check data sent by the editor before it's written to disk. Returns a reason, or null if it's fine. */
export function validate(platforms: unknown, spots: unknown): string | null {
  if (!Array.isArray(platforms) || platforms.length < 4 || platforms.length > 2000) return 'platforms must be a list';
  for (const [i, raw] of platforms.entries()) {
    const p = raw as PlatformDef;
    if (!p || !KINDS.has(p.kind)) return `platform ${i}: bad kind`;
    if (![p.x, p.y, p.w, p.h, p.area].every(finite)) return `platform ${i}: bad numbers`;
    if (p.w <= 0 || p.h <= 0) return `platform ${i}: size must be positive`;
    if (p.mover && !(finite(p.mover.range) && finite(p.mover.speed))) return `platform ${i}: bad mover`;
    if (p.role && !['trapdoor', 'plug', 'troll'].includes(p.role)) return `platform ${i}: bad role`;
    if (p.onlyIn && !['original', 'newage'].includes(p.onlyIn)) return `platform ${i}: bad mode`;
    if (p.note !== undefined && typeof p.note !== 'string') return `platform ${i}: bad note`;
  }
  if (!platforms.some(p => (p as PlatformDef).kind === 'goal')) return 'the map needs a goal';
  const s = spots as Spots;
  const isSpot = (v: unknown) => !!v && finite((v as Spots['start']).x) && finite((v as Spots['start']).y);
  if (!s || !isSpot(s.start) || !isSpot(s.goopReset) || !Array.isArray(s.teleports) || !s.teleports.every(isSpot)) return 'bad start, goop reset or teleports';
  return null;
}
