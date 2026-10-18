// Player-made maps: the data a player edits in the map maker and uploads (a MapDoc), how it's
// checked, and how it becomes a playable MapDef. The same checks run in the game and on the
// server, so a map that the editor accepts is a map the server accepts.

import type { MapDef, PlatformDef, PlatformKind } from './map-types';
import { DUDE } from './map-types';
import type { Mode } from './types';

export interface MapDoc {
  name: string;
  /** The one mode the map is played in. */
  mode: Mode;
  /** The sky: 'sunset' climbs into night, 'dawn' climbs into morning. */
  theme: 'sunset' | 'dawn';
  world: { w: number; h: number };
  start: { x: number; y: number };
  /** Where Original's goop timer sends you (usually the start). */
  goopReset: { x: number; y: number };
  /** The first four are the outer walls: floor, left wall, right wall, ceiling. */
  platforms: PlatformDef[];
}

export const LIMITS = {
  name: 40,
  minW: 800,
  maxW: 6000,
  minH: 1000,
  maxH: 20000,
  /** Collision checks scale with the piece count, so this keeps checking long runs affordable. */
  pieces: 400,
  moverRange: 4000,
  moverSpeed: 30,
  note: 80,
} as const;

const KINDS: readonly PlatformKind[] = ['girder', 'spring', 'goop', 'target', 'goal'];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number) => Math.round(v * 100) / 100;

/** Player maps have ids like "draft-..." (on this device) or "c-..." (uploaded). */
export const isCustomMapId = (id: string): boolean => /^(draft|c)-[a-z0-9]{4,24}$/.test(id);
export const isCommunityMapId = (id: string): boolean => /^c-[a-z0-9]{4,24}$/.test(id);

/** Clean up a map name: one line, no control characters, at most 40 characters. */
export function cleanName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.name);
}

/** The four outer walls for a world of this size. */
export function outerWalls(w: number, h: number): PlatformDef[] {
  return [
    { kind: 'girder', x: 0, y: h - 100, w, h: 100, area: 0, note: 'floor' },
    { kind: 'girder', x: 0, y: 0, w: 100, h, area: 0, note: 'left wall' },
    { kind: 'girder', x: w - 100, y: 0, w: 100, h, area: 0, note: 'right wall' },
    { kind: 'girder', x: 0, y: 0, w, h: 100, area: 0, note: 'ceiling' },
  ];
}

/** A small starter map: the first steps of The Crane, with a goal on top. */
export function newDoc(name: string, mode: Mode): MapDoc {
  const w = 2000;
  const h = 1800;
  const start = { x: 1177, y: h - 100 - DUDE.h };
  const t = (x: number, y: number): PlatformDef => ({ kind: 'target', x, y, w: 25, h: 25, area: 1 });
  const g = (x: number, y: number, gw: number, gh: number): PlatformDef => ({ kind: 'girder', x, y, w: gw, h: gh, area: 1 });
  return {
    name,
    mode,
    theme: mode === 'original' ? 'sunset' : 'dawn',
    world: { w, h },
    start,
    goopReset: { ...start },
    platforms: [
      ...outerWalls(w, h),
      t(1408, 1408),
      g(1480, 1460, 420, 40),
      t(1388, 1168),
      g(950, 1220, 380, 40),
      t(858, 928),
      g(400, 980, 420, 40),
      t(888, 688),
      g(960, 740, 600, 40),
      { kind: 'goal', x: 1300, y: 650, w: 120, h: 90, area: 1 },
    ],
  };
}

/** Start a player map from a built-in one (map tricks and pieces from the other mode are left out). */
export function docFromMap(map: MapDef, mode: Mode, name: string): MapDoc {
  const platforms = map.platforms
    .filter(p => !p.role && (!p.onlyIn || p.onlyIn === mode))
    .map(p => {
      const q: PlatformDef = { kind: p.kind, x: p.x, y: p.y, w: p.w, h: p.h, area: p.area };
      if (p.mover) q.mover = { ...p.mover };
      if (p.note) q.note = p.note;
      return q;
    });
  return { name, mode, theme: map.theme, world: { ...map.world }, start: { ...map.start }, goopReset: { ...map.goopReset }, platforms };
}

/**
 * Check a map someone made (or sent). Returns the reason it can't be used, or null if it's fine.
 * Only what the map maker can produce gets through: no map tricks, no pieces for the other mode.
 */
export function checkDoc(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'That isn’t a map.';
  const d = raw as MapDoc;
  if (typeof d.name !== 'string' || !cleanName(d.name)) return 'Give the map a name.';
  if (d.mode !== 'original' && d.mode !== 'newage') return 'Pick the mode the map is played in.';
  if (d.theme !== 'sunset' && d.theme !== 'dawn') return 'Pick a sky.';
  const w = d.world?.w;
  const h = d.world?.h;
  if (!finite(w) || !finite(h) || w < LIMITS.minW || w > LIMITS.maxW || h < LIMITS.minH || h > LIMITS.maxH)
    return `The map must be ${LIMITS.minW}–${LIMITS.maxW} wide and ${LIMITS.minH}–${LIMITS.maxH} tall.`;
  const inside = (s: unknown) => !!s && finite((s as MapDoc['start']).x) && finite((s as MapDoc['start']).y) && (s as MapDoc['start']).x >= 0 && (s as MapDoc['start']).y >= 0 && (s as MapDoc['start']).x + DUDE.w <= w && (s as MapDoc['start']).y + DUDE.h <= h;
  if (!inside(d.start)) return 'The start has to be inside the map.';
  if (!inside(d.goopReset)) return 'The goop reset point has to be inside the map.';
  if (!Array.isArray(d.platforms)) return 'The map has no pieces.';
  if (d.platforms.length < 5) return 'The map needs more than its outer walls.';
  if (d.platforms.length > LIMITS.pieces) return `A map can have at most ${LIMITS.pieces} pieces.`;
  let goals = 0;
  for (const [i, p] of d.platforms.entries()) {
    const where = i < 4 ? ['The floor', 'The left wall', 'The right wall', 'The ceiling'][i] : `Piece ${i}`;
    if (!p || typeof p !== 'object' || !KINDS.includes(p.kind)) return `${where} isn’t a known kind of piece.`;
    if (i < 4 && p.kind !== 'girder') return `${where} has to be a girder.`;
    if (![p.x, p.y, p.w, p.h, p.area].every(finite)) return `${where} has a bad number.`;
    if (p.w <= 0 || p.h <= 0 || p.w > w + 200 || p.h > h + 200) return `${where} has a bad size.`;
    if (p.x < -200 || p.y < -200 || p.x > w + 200 || p.y > h + 200) return `${where} is outside the map.`;
    if (p.kind === 'target' && (p.w !== 25 || p.h !== 25)) return `${where}: targets are always 25 × 25.`;
    if (p.mover) {
      const m = p.mover;
      if (!finite(m.range) || !finite(m.speed) || m.range < 0 || m.range > LIMITS.moverRange || Math.abs(m.speed) > LIMITS.moverSpeed || m.speed === 0) return `${where} moves in a way it can’t.`;
    }
    if (p.role) return `${where} uses a map trick the map maker doesn’t have.`;
    if (p.onlyIn) return `${where} only exists in one mode; player maps have one mode.`;
    if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > LIMITS.note)) return `${where} has a bad note.`;
    if (p.kind === 'goal') goals++;
  }
  if (!goals) return 'The map needs a goal.';
  return null;
}

/** A checked doc, with only the fields that matter and numbers rounded (what's stored and hashed). */
export function cleanDoc(d: MapDoc): MapDoc {
  const spot = (s: { x: number; y: number }) => ({ x: round(s.x), y: round(s.y) });
  return {
    name: cleanName(d.name),
    mode: d.mode,
    theme: d.theme,
    world: { w: Math.round(d.world.w), h: Math.round(d.world.h) },
    start: spot(d.start),
    goopReset: spot(d.goopReset),
    platforms: d.platforms.map(p => {
      const q: PlatformDef = { kind: p.kind, x: round(p.x), y: round(p.y), w: round(p.w), h: round(p.h), area: Math.max(0, Math.min(99, Math.round(p.area))) };
      if (p.mover) q.mover = { range: round(p.mover.range), speed: round(p.mover.speed) };
      if (p.note) q.note = p.note;
      return q;
    }),
  };
}

/** The playable map for a doc. */
export function docToMap(id: string, d: MapDoc, by?: string): MapDef {
  return {
    id,
    name: cleanName(d.name) || 'Untitled map',
    tagline: by ? `A map by ${by}.` : 'A map you made.',
    designedFor: d.mode,
    world: { ...d.world },
    start: { ...d.start },
    goopReset: { ...d.goopReset },
    teleports: [],
    platforms: d.platforms,
    theme: d.theme,
    metersPer: 40,
  };
}
