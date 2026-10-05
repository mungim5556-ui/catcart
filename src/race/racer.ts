import * as THREE from 'three';
import { AiDriver } from '../ai/aiDriver';
import { CatKart, type Ability, type CatCharacter, type CatStyle } from '../kart/catKart';
import { KartPhysics } from '../kart/kartPhysics';
import type { KartInput } from '../core/input';
import type { Track } from '../world/track';
import { LapTracker } from './lapTracker';
import type { ItemHolder, ItemKind } from '../items/items';

const IDLE: KartInput = { throttle: 0, brake: 0, steer: 0, drift: false, driftPressed: false, reset: false, useItem: false };

/** One kart in the race: physics, model, lap tracking and (for AI) a driver. */
export class Racer implements ItemHolder {
  readonly physics = new KartPhysics();
  /** Scene node that holds the current model (swapped when the cat changes). */
  readonly root = new THREE.Group();
  model: CatKart;
  name = '';
  style!: CatStyle;
  tracker: LapTracker;
  readonly ai: AiDriver;
  /** Base pace for AI (difficulty/personality); catch-up is applied on top. */
  pace = 1;
  rocketChance = 0;
  /**
   * Who drives this kart: this device's player, the computer, or another player over the
   * network (online races; their kart state arrives as snapshots).
   */
  control: 'local' | 'ai' | 'remote' = 'ai';
  ability!: Ability;
  /** What this racer wears ('none' for nothing). */
  accessory = 'none';
  finishTime: number | null = null;
  item: ItemKind | null = null;
  itemUses = 0;
  roulette = 0;
  itemHold = 0;
  lastInput: KartInput = IDLE;

  /** Floating nickname over other players' karts (online). */
  private nameTag: THREE.Sprite | null = null;

  readonly prevPos = new THREE.Vector3();
  prevYaw = 0;
  readonly renderPos = new THREE.Vector3();
  renderYaw = 0;

  constructor(
    character: CatCharacter,
    readonly isPlayer: boolean,
    track: Track,
  ) {
    this.model = new CatKart(character.style);
    this.root.add(this.model.root);
    this.tracker = new LapTracker(track);
    // The player gets a driver too: it takes over after the finish line.
    this.ai = new AiDriver(track, { laneBias: 0, driftSkill: 0.8 });
    if (isPlayer) this.control = 'local';
    this.setCharacter(character);
  }

  setTrack(track: Track): void {
    this.tracker = new LapTracker(track);
    this.ai.track = track;
  }

  /** Switches which cat this racer is (model, name and AI personality). */
  setCharacter(c: CatCharacter): void {
    this.name = this.isPlayer ? `${c.name} (나)` : c.name;
    if (this.style !== c.style) {
      this.root.remove(this.model.root);
      this.model.dispose();
      this.model = new CatKart(c.style);
      this.root.add(this.model.root);
      this.style = c.style;
      this.model.setAccessory(this.accessory);
    }
    this.ability = c.ability;
    this.physics.mods = { driftBoost: c.ability.driftBoost ?? 1, shield: c.ability.shield ?? 1, spin: c.ability.spin ?? 1 };
    this.pace = c.ai.pace;
    this.rocketChance = c.ai.rocketChance;
    if (!this.isPlayer) this.ai.profile.driftSkill = c.ai.driftSkill;
  }

  setAccessory(id: string): void {
    this.accessory = id;
    this.model.setAccessory(id);
  }

  place(pose: { pos: THREE.Vector3; yaw: number }): void {
    this.physics.place(pose.pos, pose.yaw);
    this.tracker.reset(this.physics.pos);
    this.finishTime = null;
    this.lastInput = IDLE;
    this.item = null;
    this.itemUses = 0;
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

  /** Shows `text` floating over the kart (null removes it). */
  setNameTag(text: string | null, color = '#ffffff'): void {
    if (this.nameTag) {
      this.root.remove(this.nameTag);
      this.nameTag.material.map?.dispose();
      this.nameTag.material.dispose();
      this.nameTag = null;
    }
    if (!text) return;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.font = 'bold 34px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    const w = Math.min(248, g.measureText(text).width + 28);
    g.fillStyle = 'rgba(40,30,60,.72)';
    g.beginPath();
    g.roundRect((256 - w) / 2, 8, w, 48, 24);
    g.fill();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 33, 230);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Drawn on top so you can always spot your friends in the pack.
    this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.nameTag.scale.set(4, 1, 1);
    this.nameTag.renderOrder = 10;
    this.root.add(this.nameTag);
  }

  interpolate(alpha: number): void {
    this.renderPos.lerpVectors(this.prevPos, this.physics.pos, alpha);
    this.nameTag?.position.set(this.renderPos.x, this.renderPos.y + 3.4, this.renderPos.z);
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
