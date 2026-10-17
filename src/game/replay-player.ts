// Plays a replay at a chosen speed, with pause and seeking. Seeking backwards restores the
// nearest keyframe (a snapshot taken every 10 seconds of game time) and simulates forward.

import { snapshot, type Snapshot } from '../render/renderer';
import { ReplayRunner, type RecordedInput, type Replay } from '../sim/replay';
import type { SimState } from '../sim/sim';
import type { SimEvent } from '../sim/types';
import { TICK_RATE } from '../sim/types';

const TICK = 1 / TICK_RATE;
const KEYFRAME_EVERY = 600;
export const SPEEDS = [1, 2, 4, 8, 16] as const;

export class ReplayPlayer {
  readonly replay: Replay;
  private runner: ReplayRunner;
  private keyframes = new Map<number, SimState>();
  prev: Snapshot;
  speed: number;
  paused = false;
  private acc = 0;

  constructor(replay: Replay, speed = 4) {
    this.replay = replay;
    this.runner = new ReplayRunner(replay);
    this.prev = snapshot(this.runner.sim);
    this.speed = speed;
    this.keyframes.set(0, structuredClone(this.runner.sim.state));
  }

  get sim() {
    return this.runner.sim;
  }

  get tick(): number {
    return this.runner.tick;
  }

  get end(): number {
    return this.runner.end;
  }

  get done(): boolean {
    return this.runner.done;
  }

  /** Fraction between the last two ticks, for smooth drawing. */
  get alpha(): number {
    return Math.min(1, this.acc / TICK);
  }

  private stepOnce(onTick?: (events: SimEvent[], inputs: readonly RecordedInput[]) => void): void {
    this.prev = snapshot(this.runner.sim);
    const inputs = this.runner.pending();
    const events = this.runner.step();
    const t = this.runner.tick;
    if (t % KEYFRAME_EVERY === 0 && !this.keyframes.has(t)) this.keyframes.set(t, structuredClone(this.runner.sim.state));
    onTick?.(events, inputs);
  }

  /** Advance by real time dt (seconds) at the current speed. */
  update(dt: number, onTick: (events: SimEvent[], inputs: readonly RecordedInput[]) => void): void {
    if (this.paused || this.done) return;
    this.acc += dt * this.speed;
    let steps = 0;
    while (this.acc >= TICK && !this.done && steps < 2000) {
      this.stepOnce(onTick);
      this.acc -= TICK;
      steps++;
    }
    if (this.done) this.acc = 0;
  }

  /** Jump to a tick. Nothing is drawn or heard for the skipped ticks. */
  seek(tick: number): void {
    const target = Math.max(0, Math.min(this.end, Math.round(tick)));
    if (target < this.tick) {
      let best = 0;
      for (const k of this.keyframes.keys()) if (k <= target && k > best) best = k;
      this.runner.restore(this.keyframes.get(best)!);
    }
    while (this.tick < target && !this.done) this.stepOnce();
    this.prev = snapshot(this.runner.sim);
    this.acc = 0;
  }

  restart(): void {
    this.seek(0);
    this.paused = false;
  }
}
