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
  private willTrick: boolean | null = null;

  constructor(
    public track: Track,
    readonly profile: AiProfile,
  ) {}

  drive(
    k: KartPhysics,
    tracker: LapTracker,
    others: KartPhysics[],
    dt: number,
    hazards: { x: number; z: number }[] = [],
  ): KartInput {
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
    // Steer around bananas, vacuums and cucumbers on the road ahead. Pass each one on the
    // road-centre side (there's more room there), and let a cluster push the lane
    // cumulatively so a row of cucumbers moves us past all of them, not just the last one.
    let dodging = false;
    for (const h of hazards) {
      const dx = h.x - k.pos.x;
      const dz = h.z - k.pos.z;
      const ahead = dx * t0.x + dz * t0.z;
      if (ahead <= 0 || ahead > 36) continue;
      // Measure its offset against the road where it lies, not where we are (bends skew that).
      const hi = this.track.nearestAround(h.x, h.z, idx, 24).index;
      const ht = tans[hi];
      const hLat = (h.x - pts[hi].x) * ht.z - (h.z - pts[hi].z) * ht.x;
      const gap = ahead < 14 ? 3.8 : 3.2;
      if (Math.abs(hLat - lane) >= gap) continue;
      // Near the kerb there's no room on the outside: go the other way.
      let pass = hLat > 0.5 ? -1 : hLat < -0.5 ? 1 : lane >= hLat ? 1 : -1;
      if (Math.abs(hLat + pass * gap) > MAX_LANE) pass = -pass;
      lane = pass > 0 ? Math.max(lane, hLat + gap) : Math.min(lane, hLat - gap);
      dodging = true;
    }
    lane = Math.max(-MAX_LANE, Math.min(MAX_LANE, lane));

    // --- Steering: aim at a point further ahead the faster we go ---
    // Look closer while dodging, so we hold the lane instead of cutting across it.
    const la = dodging ? 5 : 5 + Math.round(speed * 0.2);
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
    // Off a ramp: decide once per jump whether to pull a trick (better drivers trick more).
    if (!k.grounded && k.canTrick && !k.tricked) {
      if (this.willTrick === null) this.willTrick = Math.random() < 0.3 + this.profile.driftSkill * 0.6;
      if (this.willTrick && k.vel.y < 5) drift = true;
    } else if (k.grounded) this.willTrick = null;

    const driftPressed = drift && !this.prevDrift;
    this.prevDrift = drift;

    // Ease off in sharp bends when not drifting.
    const throttle = !k.drifting && Math.abs(bend) > 1.0 && speed > 22 ? 0.4 : 1;

    // --- Unstick: stopped for a while (wall, tree) → respawn on the road ---
    this.stuck = speed < 1.5 ? this.stuck + dt : 0;
    const reset = this.stuck > 1.6;
    if (reset) this.stuck = 0;

    return { throttle, brake: 0, steer: this.steer, drift, driftPressed, reset, useItem: false };
  }
}
