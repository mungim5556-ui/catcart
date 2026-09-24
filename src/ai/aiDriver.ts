import type { KartInput } from '../core/input';
import type { KartPhysics } from '../kart/kartPhysics';
import type { LapTracker } from '../race/lapTracker';
import { ROAD_WIDTH, SAMPLES, type Track } from '../world/track';

export interface AiProfile {
  /** Preferred sideways offset from the centre line (m). */
  laneBias: number;
  /** 0 = never drifts, 1 = drifts every big corner. */
  driftSkill: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const heading = (t: { x: number; z: number }) => Math.atan2(t.x, t.z);
const MAX_LANE = ROAD_WIDTH / 2 - 2;

/**
 * Drives a kart along the track centre line (pure pursuit) with a wandering
 * lane, steers around karts ahead, and drifts through big corners.
 */
export class AiDriver {
  private steer = 0;
  private prevDrift = false;
  private stuck = 0;
  private wander = Math.random() * 10;
  private willDrift = true;

  constructor(
    private track: Track,
    private profile: AiProfile,
  ) {}

  drive(k: KartPhysics, tracker: LapTracker, others: KartPhysics[], dt: number): KartInput {
    const pts = this.track.points;
    const tans = this.track.tangents;
    const idx = tracker.index;
    const speed = Math.max(0, k.forwardSpeed);

    // --- Lane choice: gentle wander + get around slower karts ahead ---
    this.wander += dt * 0.35;
    const t0 = tans[idx];
    const nx = t0.z;
    const nz = -t0.x;
    const lateral = (x: number, z: number) => (x - pts[idx].x) * nx + (z - pts[idx].z) * nz;
    const myLat = lateral(k.pos.x, k.pos.z);
    let lane = this.profile.laneBias + Math.sin(this.wander) * 2;
    for (const o of others) {
      if (o === k) continue;
      const dx = o.pos.x - k.pos.x;
      const dz = o.pos.z - k.pos.z;
      const ahead = dx * t0.x + dz * t0.z;
      if (ahead <= 0 || ahead > 14) continue;
      const oLat = lateral(o.pos.x, o.pos.z);
      if (Math.abs(oLat - myLat) < 2.8) {
        lane = oLat + (myLat >= oLat ? 3.6 : -3.6);
        break;
      }
    }
    lane = Math.max(-MAX_LANE, Math.min(MAX_LANE, lane));

    // --- Steering: aim at a point further ahead the faster we go ---
    const la = 5 + Math.round(speed * 0.2);
    const ti = (idx + la) % SAMPLES;
    const tt = tans[ti];
    const tx = pts[ti].x + tt.z * lane;
    const tz = pts[ti].z - tt.x * lane;
    const err = wrap(Math.atan2(tx - k.pos.x, tz - k.pos.z) - k.yaw);
    const target = Math.max(-1, Math.min(1, -err * 2.6));
    this.steer += (target - this.steer) * Math.min(1, dt * 12);

    // --- Drift through big bends ---
    const bend = wrap(heading(tans[(idx + 22) % SAMPLES]) - heading(tans[(idx + 4) % SAMPLES]));
    const bendSteer = bend > 0 ? -1 : 1; // steer sign that follows the bend
    let drift = false;
    if (k.drifting) {
      drift = !(this.steer * k.driftDir < -0.6 || (Math.abs(bend) < 0.15 && k.driftLevel >= 1) || k.driftLevel >= 3);
    } else if (Math.abs(bend) > 0.5 && speed > 14 && this.steer * bendSteer > 0.2) {
      // Decide once per corner whether this driver attempts it.
      if (!this.prevDrift) this.willDrift = Math.random() < this.profile.driftSkill;
      drift = this.willDrift;
    }
    const driftPressed = drift && !this.prevDrift;
    this.prevDrift = drift;

    // Ease off in sharp bends when not drifting.
    const throttle = !k.drifting && Math.abs(bend) > 1.0 && speed > 22 ? 0.4 : 1;

    // --- Unstick: stopped for a while (wall, tree) → respawn on the road ---
    this.stuck = speed < 1.5 ? this.stuck + dt : 0;
    const reset = this.stuck > 1.6;
    if (reset) this.stuck = 0;

    return { throttle, brake: 0, steer: this.steer, drift, driftPressed, reset };
  }
}
