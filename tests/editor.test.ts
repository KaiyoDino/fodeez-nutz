import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { platformCall, regionSource, REGION_END, REGION_START, replaceRegion, validate } from '../src/editor/codegen';
import { girder, goal, MAPS, target, type MapId } from '../src/sim/level';

const file = (id: MapId) => readFileSync(join(import.meta.dirname, '..', 'src', 'sim', 'maps', `${id}.ts`), 'utf8');
const region = (text: string) => text.slice(text.indexOf(REGION_START), text.indexOf(REGION_END) + REGION_END.length);

describe('level editor code generation', () => {
  for (const id of Object.keys(MAPS) as MapId[]) {
    it(`writes ${id} back exactly as it is`, () => {
      const map = MAPS[id];
      const src = regionSource(map, map.platforms, { start: map.start, goopReset: map.goopReset, teleports: [...map.teleports] });
      expect(src).toBe(region(file(id)));
      expect(replaceRegion(file(id), src)).toBe(file(id));
    });
  }

  it('formats each kind of platform', () => {
    expect(platformCall(girder(1, 2, 3, 4, 5))).toBe('g(1, 2, 3, 4, 5)');
    expect(platformCall(target(10, 20, 3, { role: 'troll' }))).toBe("t(10, 20, 3, { role: 'troll' })");
    expect(platformCall(girder(0, 0, 10, 10, 1, { mover: { range: 200, speed: 6 }, onlyIn: 'newage', note: "it's" }))).toBe("g(0, 0, 10, 10, 1, { mover: { range: 200, speed: 6 }, onlyIn: 'newage', note: 'it\\'s' })");
    expect(platformCall(goal(1, 2, 3, 4, 6))).toBe('goal(1, 2, 3, 4, 6)');
  });

  it('refuses data that would break the map file', () => {
    const ok = MAPS.crane.platforms;
    const spots = { start: { x: 0, y: 0 }, goopReset: { x: 0, y: 0 }, teleports: [] };
    expect(validate(ok, spots)).toBeNull();
    expect(validate(ok.filter(p => p.kind !== 'goal'), spots)).toMatch(/goal/);
    expect(validate([...ok, { ...ok[5], w: -3 }], spots)).toMatch(/size/);
    expect(validate([...ok, { ...ok[5], x: Number.NaN }], spots)).toMatch(/numbers/);
    expect(validate([...ok, { ...ok[5], kind: 'lava' }], spots)).toMatch(/kind/);
    expect(validate(ok, { start: { x: 0 } })).toMatch(/start/);
  });

  it('only replaces the marked region', () => {
    expect(() => replaceRegion('no markers here', 'x')).toThrow();
    expect(replaceRegion(`a\n${REGION_START}\nold\n${REGION_END}\nb`, `${REGION_START}\nnew\n${REGION_END}`)).toBe(`a\n${REGION_START}\nnew\n${REGION_END}\nb`);
  });
});
