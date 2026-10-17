import type { MapDef, MapId } from '../map-types';
import { CRANE } from './crane';
import { TOWER } from './tower';

export const MAPS: Record<MapId, MapDef> = { tower: TOWER, crane: CRANE };
export const MAP_IDS: readonly MapId[] = ['tower', 'crane'];

export function getMap(id: MapId): MapDef {
  return MAPS[id] ?? TOWER;
}
