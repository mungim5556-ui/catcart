import * as THREE from 'three';
import type { KartInput } from '../core/input';

/** What the kart needs to know about the world it drives on. */
export interface KartWorld {
  heightAt(x: number, z: number): number;
  isOffroad(x: number, z: number): boolean;
  isBoostPad(x: number, z: number): boolean;
  /** Pushes the kart out of obstacles/walls; returns true on a hit. */
  collide(pos: THREE.Vector3, vel: THREE.Vector3, radius: number): boolean;
  respawnPoint(x: number, z: number): { pos: THREE.Vector3; yaw: number };
}

/** Tuning values. Arcade feel matters more than realism — tweak freely. */
export const KART = {
  radius: 1.1,
  maxSpeed: 26,
  maxReverse: 9,
  accel: 17,
  brakeDecel: 32,
  coastDecel: 6,
  turnRate: 2.3,
  grip: 9,
  driftGrip: 4,
  traction: 0.92,
  driftTraction: 0.8,
  offroadFactor: 0.55,
  boostSpeed: 36,
  boostAccel: 45,
  gravity: 32,
  hopVelocity: 5.5,
  driftMinSpeed: 9,
  /** Seconds of drift needed for each mini-turbo level (blue, orange, purple). */
  /** Drift turn rate (rad/s) when steering out of / neutral / into the drift. */
  driftTurnMin: 0.15,
  driftTurnBase: 0.6,
  driftTurnMax: 1.3,
  driftLevels: [0.8, 1.7, 2.7],
  /** Boost duration awarded for each mini-turbo level. */
  driftBoost: [0, 0.6, 1.1, 1.7],
  padBoost: 1.2,
};

/** Drift mini-turbo level (1-3) or a boost pad. */
export type BoostSource = number | 'pad';

export interface StepEvents {
  landed: number; // impact speed when touching down this step
  hit: boolean; // bumped into a wall/obstacle
  boost: BoostSource | null; // a new boost started
  hop: boolean;
}

export class KartPhysics {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  yawRate = 0;
  grounded = true;

  drifting = false;
  driftDir = 0; // -1 left, 1 right
  driftCharge = 0;
  boostTime = 0;
  offroad = false;

  /** Set for one step when something visual should react. */
  events: StepEvents = { landed: 0, hit: false, boost: null, hop: false };

  private driftWindow = 0; // time after a hop in which a drift can still start

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get right(): THREE.Vector3 {
    return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  get forwardSpeed(): number {
    return this.vel.dot(this.forward);
  }

  get driftLevel(): number {
    if (!this.drifting) return 0;
    return KART.driftLevels.filter((t) => this.driftCharge >= t).length;
  }

  place(pos: THREE.Vector3, yaw: number): void {
    this.pos.copy(pos);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.drifting = false;
    this.boostTime = 0;
  }

  step(dt: number, input: KartInput, world: KartWorld): void {
    this.events = { landed: 0, hit: false, boost: null, hop: false };

    if (input.reset) {
      const r = world.respawnPoint(this.pos.x, this.pos.z);
      this.place(r.pos, r.yaw);
      return;
    }

    const f = this.forward;
    const r = this.right;
    let fs = this.vel.dot(f);
    let ls = this.vel.dot(r);
    let vy = this.vel.y;

    this.offroad = world.isOffroad(this.pos.x, this.pos.z);
    if (this.grounded && world.isBoostPad(this.pos.x, this.pos.z)) this.addBoost(KART.padBoost, 'pad');
    const boosting = this.boostTime > 0;
    this.boostTime = Math.max(0, this.boostTime - dt);

    let top = boosting ? KART.boostSpeed : KART.maxSpeed;
    if (this.offroad && !boosting) top *= KART.offroadFactor;

    // --- Longitudinal ---
    if (this.grounded) {
      if (input.throttle > 0 && fs < top) {
        fs += (boosting ? KART.boostAccel : KART.accel) * input.throttle * dt;
        fs = Math.min(fs, top);
      }
      if (boosting && fs < top) fs = Math.min(top, fs + KART.boostAccel * dt);
      if (input.brake > 0) {
        if (fs > 0.5) fs -= KART.brakeDecel * input.brake * dt;
        else fs = Math.max(-KART.maxReverse, fs - KART.accel * 0.6 * input.brake * dt);
      }
      if (input.throttle === 0 && input.brake === 0 && !boosting) {
        fs -= Math.sign(fs) * Math.min(Math.abs(fs), KART.coastDecel * dt);
      }
      // Ease down when over the limit (leaving a boost or driving onto grass).
      if (fs > top) fs = Math.max(top, fs - 22 * dt);
      ls *= Math.exp(-(this.drifting ? KART.driftGrip : KART.grip) * dt);
    }

    // --- Drift state machine: hop, then hold + steer to drift, release for mini-turbo ---
    this.driftWindow = Math.max(0, this.driftWindow - dt);
    if (input.driftPressed && this.grounded && !this.drifting) {
      this.grounded = false;
      vy = KART.hopVelocity;
      this.driftWindow = 0.45;
      this.events.hop = true;
    }
    if (
      !this.drifting &&
      this.driftWindow > 0 &&
      input.drift &&
      Math.abs(input.steer) > 0.3 &&
      fs > KART.driftMinSpeed
    ) {
      this.drifting = true;
      this.driftDir = Math.sign(input.steer);
      this.driftCharge = 0;
      this.driftWindow = 0;
    }
    if (this.drifting) {
      if (!input.drift || fs < KART.driftMinSpeed * 0.6) {
        const level = this.driftLevel;
        this.drifting = false;
        if (level > 0) this.addBoost(KART.driftBoost[level], level);
      } else if (this.grounded) {
        // Actively steering (either way) charges faster than holding neutral.
        this.driftCharge += dt * (1 + 0.5 * Math.abs(input.steer));
      }
    }

    // --- Steering ---
    const speedFactor = Math.min(1, Math.abs(fs) / 6) * (fs >= 0 ? 1 : -1);
    if (this.drifting) {
      // Always turns toward the drift side; steering only tightens or widens it,
      // so counter-steering lets you hold a drift through gentle corners.
      const s = input.steer * this.driftDir;
      const rate =
        s >= 0
          ? KART.driftTurnBase + (KART.driftTurnMax - KART.driftTurnBase) * s
          : KART.driftTurnBase + (KART.driftTurnBase - KART.driftTurnMin) * s;
      this.yawRate = -this.driftDir * rate * speedFactor;
    } else {
      this.yawRate = -input.steer * (this.grounded ? 1 : 0.5) * KART.turnRate * speedFactor;
    }
    const dYaw = this.yawRate * dt;
    this.yaw += dYaw;

    // Arcade traction: most of the velocity turns with the kart (so turning
    // doesn't bleed speed); the remainder becomes sideways slide that grip removes.
    this.vel.copy(f).multiplyScalar(fs).addScaledVector(r, ls);
    if (this.grounded) {
      const a = dYaw * (this.drifting ? KART.driftTraction : KART.traction);
      const { x, z } = this.vel;
      this.vel.x = x * Math.cos(a) + z * Math.sin(a);
      this.vel.z = -x * Math.sin(a) + z * Math.cos(a);
    }
    this.vel.y = vy;

    // --- Move + vertical ---
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const ground = world.heightAt(this.pos.x, this.pos.z);
    if (this.grounded) {
      if (ground >= this.pos.y - 0.15) {
        // Follow the ground; remember the climb rate so ramps launch us.
        this.vel.y = (ground - this.pos.y) / dt;
        this.pos.y = ground;
      } else {
        this.grounded = false;
      }
    }
    if (!this.grounded) {
      this.vel.y -= KART.gravity * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        this.events.landed = -this.vel.y;
        this.pos.y = ground;
        this.vel.y = 0;
        this.grounded = true;
      }
    }

    if (world.collide(this.pos, this.vel, KART.radius)) {
      this.events.hit = true;
      if (this.drifting) this.drifting = false;
    }
  }

  private addBoost(seconds: number, source: BoostSource): void {
    if (this.boostTime <= 0.05) this.events.boost = source;
    this.boostTime = Math.max(this.boostTime, seconds);
  }
}
