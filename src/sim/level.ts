// Maps live in ./maps; this module re-exports the shared map vocabulary and the registry.
export * from './map-types';
export { getMap, MAP_IDS, MAPS } from './maps';
export { NEW_AGE_LADDER, TOWER } from './maps/tower';
export { CRANE } from './maps/crane';
