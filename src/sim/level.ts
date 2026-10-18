// Maps live in ./maps; this module re-exports the shared map vocabulary and the registry.
export * from './map-types';
export { getMap, hasMap, isBuiltinMap, MAP_IDS, MAPS, registerMap, unregisterMap } from './maps';
export { NEW_AGE_LADDER, TOWER } from './maps/tower';
export { CRANE } from './maps/crane';
