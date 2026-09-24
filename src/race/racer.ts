import * as THREE from 'three';
import { AiDriver, type AiProfile } from '../ai/aiDriver';
import { CatKart, type CatStyle } from '../kart/catKart';
import { KartPhysics } from '../kart/kartPhysics';
import type { KartInput } from '../core/input';
import type { Track } from '../world/track';
import { LapTracker } from './lapTracker';
import type { ItemHolder, ItemKind } from '../items/items';

const IDLE: KartInput = { throttle: 0, brake: 0, steer: 0, drift: false, driftPressed: false, reset: false, useItem: false };

/** One kart in the race: physics, model, lap tracking and (for AI) a driver. */
export class Racer implements ItemHolder {
  readonly physics = new KartPhysics();
  readonly model: CatKart;
  readonly tracker: LapTracker;
  readonly ai: AiDriver;
  /** Base pace for AI (difficulty/personality); catch-up is applied on top. */
  pace = 1;
  rocketChance = 0;
  finishTime: number | null = null;
  item: ItemKind | null = null;
  roulette = 0;
  itemHold = 0;
  lastInput: KartInput = IDLE;

  readonly prevPos = new THREE.Vector3();
  prevYaw = 0;
  readonly renderPos = new THREE.Vector3();
  renderYaw = 0;

  constructor(
    readonly name: string,
    readonly style: CatStyle,
    readonly isPlayer: boolean,
    track: Track,
    profile: AiProfile,
  ) {
    this.model = new CatKart(style);
    this.tracker = new LapTracker(track);
    // The player gets a driver too: it takes over after the finish line.
    this.ai = new AiDriver(track, profile);
  }

  place(pose: { pos: THREE.Vector3; yaw: number }): void {
    this.physics.place(pose.pos, pose.yaw);
    this.tracker.reset(this.physics.pos);
    this.finishTime = null;
    this.lastInput = IDLE;
    this.item = null;
    this.roulette = 0;
    this.itemHold = 0;
    this.snapRender();
  }

  /** Call before each physics step so rendering can interpolate. */
  beginStep(): void {
    this.prevPos.copy(this.physics.pos);
    this.prevYaw = this.physics.yaw;
  }

  snapRender(): void {
    this.prevPos.copy(this.physics.pos);
    this.prevYaw = this.physics.yaw;
  }

  interpolate(alpha: number): void {
    this.renderPos.lerpVectors(this.prevPos, this.physics.pos, alpha);
    const dy = Math.atan2(Math.sin(this.physics.yaw - this.prevYaw), Math.cos(this.physics.yaw - this.prevYaw));
    this.renderYaw = this.prevYaw + dy * alpha;
  }

  get finished(): boolean {
    return this.finishTime !== null;
  }
}

/** Pushes overlapping karts apart and trades their velocity along the contact normal. */
export function collideKarts(racers: Racer[], radius: number): Racer[] {
  const bumped: Racer[] = [];
  const min = radius * 2;
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i].physics;
      const b = racers[j].physics;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-6 || Math.abs(a.pos.y - b.pos.y) > 1.2) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      const push = (min - d) / 2;
      a.pos.x -= nx * push;
      a.pos.z -= nz * push;
      b.pos.x += nx * push;
      b.pos.z += nz * push;
      const vn = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (vn < 0) {
        const j2 = -(1 + 0.4) * vn * 0.5;
        a.vel.x -= nx * j2;
        a.vel.z -= nz * j2;
        b.vel.x += nx * j2;
        b.vel.z += nz * j2;
        if (vn < -3) bumped.push(racers[i], racers[j]);
      }
    }
  }
  return bumped;
}

export const IDLE_INPUT = IDLE;
