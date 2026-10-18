import type { BuiltinMapId, MapDef, MapId } from '../map-types';
import { CRANE } from './crane';
import { TOWER } from './tower';

/** Every map the game knows right now: the built-in ones, plus drafts and community maps once they're registered. */
export const MAPS: Record<MapId, MapDef> = { tower: TOWER, crane: CRANE };
/** The maps that ship with the game. */
export const MAP_IDS: readonly BuiltinMapId[] = ['tower', 'crane'];

export const isBuiltinMap = (id: string): id is BuiltinMapId => id === 'tower' || id === 'crane';

export const hasMap = (id: unknown): id is MapId => typeof id === 'string' && Object.hasOwn(MAPS, id);

/** Make a player-made map playable (or replace it after an edit). Built-in maps can't be replaced. */
export function registerMap(def: MapDef): void {
  if (isBuiltinMap(def.id)) throw new Error(`can't replace the built-in map ${def.id}`);
  MAPS[def.id] = def;
}

/** Forget a player-made map (one the server turned down, say). */
export function unregisterMap(id: MapId): void {
  if (!isBuiltinMap(id)) delete MAPS[id];
}

export function getMap(id: MapId): MapDef {
  return hasMap(id) ? MAPS[id] : TOWER;
}
