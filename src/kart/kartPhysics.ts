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
  /** Drift turn rate (rad/s) when steering out of / neutral / into the drift. */
  driftTurnMin: 0.05,
  driftTurnBase: 0.38,
  driftTurnMax: 1.5,
  /** Seconds of drift needed for each mini-turbo level (blue, orange, purple). */
  driftLevels: [0.8, 1.7, 2.7],
  /** Boost duration awarded for each mini-turbo level. */
  driftBoost: [0, 0.6, 1.1, 1.7],
  padBoost: 1.2,
  rocketBoost: 1.3,
  fishBoost: 1.6,
  slipDuration: 0.9,
  shieldDuration: 10,
  catnipDuration: 6,
  catnipSpeed: 1.15,
  /** Upward speed when leaving a ramp (plus a bit per unit of forward speed). */
  rampLaunch: 7.5,
  /** Upward speed a kart can pick up from climbing (a ramp head-on at top speed is ~9). */
  maxClimbSpeed: 10,
  rampLaunchPerSpeed: 0.13,
  trickDuration: 0.45,
  trickBoost: 1.0,
  /** Spin-out after being hit by an item. */
  spinDuration: 1.1,
  hitInvuln: 0.8,
};

/** Drift mini-turbo level (1-3), a boost pad, or a rocket start. */
export type BoostSource = number | 'pad' | 'rocket' | 'fish' | 'catnip' | 'trick';

export interface StepEvents {
  landed: number; // impact speed when touching down this step
  hit: boolean; // bumped into a wall/obstacle
  blocked?: boolean; // a box shield absorbed an item hit
  boost: BoostSource | null; // a new boost started
  hop: boolean;
  launch?: boolean; // flew off a ramp: a trick is possible
  trick?: boolean; // started a trick in the air
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
  /** Time left spinning out after an item hit (no control). */
  spinTime = 0;
  /** Time left immune to item hits. */
  invulnTime = 0;
  /** 📦 Box shield: absorbs the next hit while > 0. */
  shieldTime = 0;
  /** 🌿 Catnip: invincible and faster while > 0. */
  starTime = 0;
  /** 🥛 Slipping on milk: wobbles, no spin-out. */
  slipTime = 0;
  /** Airborne off a ramp and no trick done yet. */
  canTrick = false;
  tricked = false;
  /** Time left in the trick spin animation. */
  trickTime = 0;
  /** Per-kart speed scale (AI skill, catch-up); 1 = normal. */
  speedMul = 1;

  /** Set for one step when something visual should react. */
  events: StepEvents = { landed: 0, hit: false, boost: null, hop: false };

  private inStep = false;
  private boostBetweenSteps: BoostSource | null = null;
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
    this.spinTime = 0;
    this.invulnTime = 0;
    this.shieldTime = 0;
    this.starTime = 0;
    this.slipTime = 0;
    this.canTrick = this.tricked = false;
    this.trickTime = 0;
    this.boostBetweenSteps = null;
  }

  /** Item hit: spin out and lose most speed. Returns false if immune or shielded. */
  hit(): boolean {
    if (this.invulnTime > 0 || this.starTime > 0) return false;
    if (this.shieldTime > 0) {
      this.shieldTime = 0;
      this.invulnTime = 0.5;
      this.events.blocked = true;
      return false;
    }
    this.spinTime = KART.spinDuration;
    this.invulnTime = KART.spinDuration + KART.hitInvuln;
    this.vel.x *= 0.25;
    this.vel.z *= 0.25;
    this.drifting = false;
    this.boostTime = 0;
    return true;
  }

  /** Milk puddle: lose speed and wobble, but keep control. */
  slip(): boolean {
    if (this.invulnTime > 0 || this.starTime > 0 || this.slipTime > 0) return false;
    this.slipTime = KART.slipDuration;
    this.vel.x *= 0.6;
    this.vel.z *= 0.6;
    this.drifting = false;
    return true;
  }

  shield(): void {
    this.shieldTime = KART.shieldDuration;
  }

  catnip(): void {
    this.starTime = KART.catnipDuration;
    this.spinTime = 0;
    this.addBoost(0.8, 'catnip');
  }

  fishBoost(): void {
    this.addBoost(KART.fishBoost, 'fish');
  }

  /** 0..1 progress through the current spin-out (0 when not spinning). */
  get spinProgress(): number {
    return this.spinTime > 0 ? 1 - this.spinTime / KART.spinDuration : 0;
  }

  step(dt: number, input: KartInput, world: KartWorld): void {
    // A boost started between steps (rocket start, fish item) is reported by this step.
    this.events = { landed: 0, hit: false, boost: this.boostBetweenSteps, hop: false };
    this.boostBetweenSteps = null;
    this.inStep = true;
    try {
      this.simulate(dt, input, world);
    } finally {
      this.inStep = false;
    }
  }

  private simulate(dt: number, input: KartInput, world: KartWorld): void {

    this.invulnTime = Math.max(0, this.invulnTime - dt);
    this.shieldTime = Math.max(0, this.shieldTime - dt);
    this.starTime = Math.max(0, this.starTime - dt);
    this.slipTime = Math.max(0, this.slipTime - dt);
    if (this.spinTime > 0) {
      // Spinning out: no control until it ends.
      this.spinTime = Math.max(0, this.spinTime - dt);
      input = { ...input, throttle: 0, brake: 0.4, steer: 0, drift: false, driftPressed: false, reset: false };
    }

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

    let top = (boosting ? KART.boostSpeed : KART.maxSpeed) * this.speedMul * (this.starTime > 0 ? KART.catnipSpeed : 1);
    if (this.offroad && !boosting && this.starTime <= 0) top *= KART.offroadFactor;

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

    // --- Jump tricks: drift button in the air after a ramp ---
    this.trickTime = Math.max(0, this.trickTime - dt);
    if (!this.grounded && this.canTrick && !this.tricked && input.driftPressed && this.spinTime <= 0) {
      this.tricked = true;
      this.trickTime = KART.trickDuration;
      this.events.trick = true;
    }

    // --- Move + vertical ---
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const ground = world.heightAt(this.pos.x, this.pos.z);
    if (this.grounded) {
      if (ground >= this.pos.y - 0.15) {
        // Follow the ground; remember the climb rate so ramps launch us. Capped: stepping onto
        // a ramp from the side jumps a metre in one frame, which would otherwise read as
        // ~80 m/s upwards and fire the kart into the sky when it slides off the edge.
        this.vel.y = Math.min((ground - this.pos.y) / dt, KART.maxClimbSpeed);
        this.pos.y = ground;
      } else {
        this.grounded = false;
        // Leaving the top of a ramp: fling the kart up so there's time for a trick.
        if (this.pos.y > 0.3) {
          this.vel.y = Math.max(this.vel.y, KART.rampLaunch + KART.rampLaunchPerSpeed * Math.abs(fs));
          this.canTrick = true;
          this.tricked = false;
          this.events.launch = true;
        }
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
        if (this.tricked && this.spinTime <= 0) this.addBoost(KART.trickBoost, 'trick');
        this.canTrick = this.tricked = false;
      }
    }

    if (world.collide(this.pos, this.vel, KART.radius)) {
      this.events.hit = true;
      if (this.drifting) this.drifting = false;
    }
  }

  rocketStart(): void {
    this.addBoost(KART.rocketBoost, 'rocket');
  }

  private addBoost(seconds: number, source: BoostSource): void {
    if (this.boostTime <= 0.05) {
      if (this.inStep) this.events.boost = source;
      else this.boostBetweenSteps = source;
    }
    this.boostTime = Math.max(this.boostTime, seconds);
  }
}
