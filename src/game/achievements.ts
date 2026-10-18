// Achievements, and the wheels they unlock. They're worked out from what the save already
// tracks (wins and best times per level) plus a few totals (distance fallen), so wins from
// before achievements existed count too.

import type { WheelId } from '../render/wheels';
import { getMap, MAP_IDS, type MapId } from '../sim/level';
import type { Mode } from '../sim/types';
import { runKey, type SaveData } from './save';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** Which section of the list it's shown in. */
  group: string;
  /** Wheels it unlocks. */
  wheels?: WheelId;
  done(save: SaveData): boolean;
  /** For running totals: how far along you are. */
  progress?(save: SaveData): { have: number; need: number; unit: string };
}

const MODE_NAME: Record<Mode, string> = { original: 'Original', newage: 'New Age' };
const MODES: Mode[] = ['original', 'newage'];
const MINUTE = 60 * 60;

/** The achievement (and wheels) for beating each level. */
const BEAT: Record<string, { name: string; wheels: WheelId }> = {
  'tower:original': { name: 'Old School', wheels: 'girder' },
  'tower:newage': { name: 'New Heights', wheels: 'neon' },
  'crane:original': { name: 'Hard Hat', wheels: 'hazard' },
  'crane:newage': { name: 'Topped Out', wheels: 'goop' },
};

const totalWins = (s: SaveData): number => Object.values(s.wins).reduce<number>((a, b) => a + (b ?? 0), 0);

function levelAchievements(map: MapId, mode: Mode): Achievement[] {
  const key = runKey(map, mode);
  const where = `${getMap(map).name} in ${MODE_NAME[mode]}`;
  const group = `${getMap(map).name} · ${MODE_NAME[mode]}`;
  const beat = BEAT[key] ?? { name: `Beat ${where}`, wheels: undefined };
  const under = (ticks: number) => (s: SaveData) => (s.best[key]?.ticks ?? Infinity) < ticks;
  return [
    { id: `beat:${key}`, name: beat.name, desc: `Beat ${where}.`, group, wheels: beat.wheels, done: s => (s.wins[key] ?? 0) > 0 },
    { id: `sub5:${key}`, name: 'Five-Minute Climb', desc: `Beat ${where} in under 5 minutes.`, group, done: under(5 * MINUTE) },
    { id: `sub1:${key}`, name: 'One-Minute Wonder', desc: `Beat ${where} in under 1 minute.`, group, done: under(MINUTE) },
  ];
}

const MILESTONES = 'Milestones';

export const ACHIEVEMENTS: Achievement[] = [
  ...MAP_IDS.flatMap(map => MODES.flatMap(mode => levelAchievements(map, mode))),
  {
    id: 'wins:5',
    name: 'Regular',
    desc: 'Beat levels 5 times in total.',
    group: MILESTONES,
    done: s => totalWins(s) >= 5,
    progress: s => ({ have: totalWins(s), need: 5, unit: 'wins' }),
  },
  {
    id: 'wins:25',
    name: 'Old Hand',
    desc: 'Beat levels 25 times in total.',
    group: MILESTONES,
    done: s => totalWins(s) >= 25,
    progress: s => ({ have: totalWins(s), need: 25, unit: 'wins' }),
  },
  {
    id: 'fall:1000',
    name: 'Gravity Checks Out',
    desc: 'Fall 1,000 m in total. Every fall of 30 m or more counts.',
    group: MILESTONES,
    done: s => s.progress.fallen >= 1000,
    progress: s => ({ have: Math.floor(s.progress.fallen), need: 1000, unit: 'm' }),
  },
  {
    id: 'fall:10000',
    name: 'Frequent Faller',
    desc: 'Fall 10,000 m in total.',
    group: MILESTONES,
    done: s => s.progress.fallen >= 10000,
    progress: s => ({ have: Math.floor(s.progress.fallen), need: 10000, unit: 'm' }),
  },
  {
    id: 'fall:big',
    name: 'All the Way Down',
    desc: 'Fall 75 m in one go.',
    group: MILESTONES,
    done: s => s.progress.biggestFall >= 75,
  },
  {
    id: 'all',
    name: 'Completionist',
    desc: 'Earn every other achievement.',
    group: MILESTONES,
    wheels: 'gold',
    done: s => ACHIEVEMENTS.every(a => a.id === 'all' || !!s.progress.unlocked[a.id]),
  },
];

/** Records any achievements that are newly earned and returns them, in list order. */
export function checkAchievements(save: SaveData): Achievement[] {
  const fresh: Achievement[] = [];
  const date = new Date().toISOString();
  // twice, so Completionist sees the ones unlocked in the first pass
  for (let pass = 0; pass < 2; pass++)
    for (const a of ACHIEVEMENTS) {
      if (save.progress.unlocked[a.id] || !a.done(save)) continue;
      save.progress.unlocked[a.id] = date;
      fresh.push(a);
    }
  return fresh;
}

/** Wheels you can put on: the standard set plus every set an earned achievement unlocks. */
export function unlockedWheels(save: SaveData): WheelId[] {
  return ['standard', ...ACHIEVEMENTS.filter(a => a.wheels && save.progress.unlocked[a.id]).map(a => a.wheels!)];
}

/** The achievement that unlocks a set of wheels. */
export const unlockFor = (wheels: WheelId): Achievement | undefined => ACHIEVEMENTS.find(a => a.wheels === wheels);
