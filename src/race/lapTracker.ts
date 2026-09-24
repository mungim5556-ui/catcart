import * as THREE from 'three';
import { SAMPLES, Track } from '../world/track';

const CHECKPOINTS = 8;
const CP_SPACING = SAMPLES / CHECKPOINTS;
/** How far past a checkpoint (in samples) still counts as passing it. */
const CP_WINDOW = CP_SPACING / 2;

/**
 * Follows one racer around the track: which centre-line sample it is at,
 * which checkpoint is next, laps completed, and wrong-way detection.
 * Written per racer so AI karts can reuse it later.
 */
export class LapTracker {
  index = 0;
  /** Laps fully completed. */
  lap = 0;
  /** Next checkpoint to hit (1..CHECKPOINTS-1), or CHECKPOINTS = only the finish line left. */
  nextCp = 1;
  wrongWay = false;
  private wrongTimer = 0;

  constructor(private track: Track) {}

  reset(pos: THREE.Vector3): void {
    this.index = this.track.nearest(pos.x, pos.z).index;
    this.lap = 0;
    this.nextCp = 1;
    this.wrongWay = false;
    this.wrongTimer = 0;
  }

  /** Continuous race distance in samples, for ranking racers. */
  get distance(): number {
    // Before crossing the line for the first time the start grid sits at the end of the loop.
    const idx = this.nextCp === 1 && this.index > SAMPLES / 2 ? this.index - SAMPLES : this.index;
    return this.lap * SAMPLES + idx;
  }

  /** Returns true on the step a lap is completed. */
  update(pos: THREE.Vector3, vel: THREE.Vector3, dt: number): boolean {
    const prev = this.index;
    let near = this.track.nearestAround(pos.x, pos.z, prev, 12);
    // Lost track of the kart (reset, big jump): fall back to a full search.
    if (near.dist > 25) near = this.track.nearest(pos.x, pos.z);
    this.index = near.index;

    let lapDone = false;
    if (this.nextCp < CHECKPOINTS) {
      const cpIdx = this.nextCp * CP_SPACING;
      if (this.index >= cpIdx && this.index < cpIdx + CP_WINDOW) this.nextCp++;
    } else if (prev > SAMPLES - CP_WINDOW && this.index < CP_WINDOW) {
      // Crossed the start/finish line going forward with every checkpoint done.
      this.lap++;
      this.nextCp = 1;
      lapDone = true;
    }

    const t = this.track.tangents[this.index];
    const along = vel.x * t.x + vel.z * t.z;
    this.wrongTimer = along < -3 ? this.wrongTimer + dt : Math.max(0, this.wrongTimer - dt * 2);
    this.wrongWay = this.wrongTimer > 0.8;
    return lapDone;
  }
}
