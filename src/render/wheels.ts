// Wheel cosmetics for the dude's chair. Each set is unlocked by an achievement (see
// game/achievements.ts); they change only how the big wheel is drawn.
import { P } from './palette';

export type WheelId = 'standard' | 'girder' | 'neon' | 'hazard' | 'goop' | 'gold';

export interface WheelStyle {
  id: WheelId;
  name: string;
  tire: string;
  /** Every other segment of the tire, so you can see it turn. */
  tread?: string;
  rim: string;
  spoke: string;
  hub: string;
  spokes: number;
}

export const WHEELS: Record<WheelId, WheelStyle> = {
  standard: { id: 'standard', name: 'Standard', tire: P.s0, rim: P.s3, spoke: P.s2, hub: P.y1, spokes: 3 },
  girder: { id: 'girder', name: 'Girder', tire: P.g0, tread: P.g1, rim: P.g3, spoke: P.g5, hub: P.y1, spokes: 2 },
  neon: { id: 'neon', name: 'Neon', tire: P.n0, tread: P.c0, rim: P.c2, spoke: P.c1, hub: P.white, spokes: 4 },
  hazard: { id: 'hazard', name: 'Hazard', tire: P.ink, tread: P.y1, rim: P.y2, spoke: P.s2, hub: P.r1, spokes: 3 },
  goop: { id: 'goop', name: 'Goop', tire: P.p0, tread: P.p1, rim: P.p3, spoke: P.p4, hub: P.p2, spokes: 3 },
  gold: { id: 'gold', name: 'Gold', tire: P.y0, tread: P.o0, rim: P.y2, spoke: P.y1, hub: P.white, spokes: 4 },
};

export const WHEEL_IDS = Object.keys(WHEELS) as WheelId[];

export const isWheelId = (v: unknown): v is WheelId => typeof v === 'string' && v in WHEELS;

export const wheelStyle = (id: string | undefined): WheelStyle => (isWheelId(id) ? WHEELS[id] : WHEELS.standard);
