import * as THREE from 'three';
import type { KartPhysics } from '../kart/kartPhysics';
import { ROAD_WIDTH, SAMPLES, type Track } from './track';
import { mergeStatic } from './mergeStatic';

/** Where a track's obstacles go (positions along the lap, 0..1). */
export interface HazardDef {
  /** 🤖 Robot vacuums sweeping back and forth across the road. */
  vacuums: number[];
  /** 🥒 Cucumber patches on the inside of a bend (cats are terrified of cucumbers). */
  cucumbers: number[];
}

export type HazardKind = 'vacuum' | 'cucumber';

export interface HazardHit {
  kart: KartPhysics;
  kind: HazardKind;
  /** false when a 📦 shield soaked it up. */
  hit: boolean;
  at: THREE.Vector3;
}

const VACUUM_R = 1.8;
const CUCUMBER_R = 0.95;
/** How far either side of the centre line a vacuum travels. */
const SWEEP = ROAD_WIDTH / 2 - 1.2;

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6, ...extra });

const MATS = {
  shell: mat(0xff7aa2),
  bumper: mat(0x3a3d4a),
  top: mat(0xfff4f8),
  eye: mat(0x1d1d28),
  shine: mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }),
  light: mat(0x49e27a, { emissive: 0x2fd35f, emissiveIntensity: 1.2 }),
  brush: mat(0x9aa3b5),
  cucumber: mat(0x4f9a3a),
  cucumberDark: mat(0x2f6b25),
  cut: mat(0xd8f0a8),
};

function vacuumMesh(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(VACUUM_R, VACUUM_R, 0.7, 18), MATS.shell);
  shell.position.y = 0.45;
  const bumper = new THREE.Mesh(new THREE.CylinderGeometry(VACUUM_R + 0.08, VACUUM_R + 0.08, 0.3, 18, 1, true, -1.3, 2.6), MATS.bumper);
  bumper.position.y = 0.4;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.14, 16), MATS.top);
  top.position.y = 0.86;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), MATS.light);
  light.position.set(0, 0.95, -0.55);
  light.name = 'light';
  g.add(shell, bumper, top, light);
  // Big cartoon eyes on the front so it reads as a "creature" charging at you.
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), MATS.eye);
    eye.scale.set(1, 1.2, 0.5);
    eye.position.set(side * 0.55, 0.62, VACUUM_R - 0.02);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), MATS.shine);
    shine.position.set(side * 0.55 + 0.08, 0.72, VACUUM_R + 0.1);
    g.add(eye, shine);
  }
  // Two little spinning side brushes at the front.
  for (const side of [-1, 1]) {
    const brush = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const bristle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.75), MATS.brush);
      bristle.position.z = 0.35;
      const arm = new THREE.Group();
      arm.rotation.y = (i / 3) * Math.PI * 2;
      arm.add(bristle);
      brush.add(arm);
    }
    brush.position.set(side * 1.1, 0.1, 1.2);
    brush.name = 'brush';
    g.add(brush);
  }
  for (const o of g.children) o.castShadow = true;
  return g;
}

function cucumberMesh(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  // Giant cucumber: big enough to spot from a distance at full speed.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.7, 3, 8), MATS.cucumber);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  // Darker bumps and a cut end so it reads as a cucumber, not a green sausage.
  for (let i = 0; i < 6; i++) {
    const bump = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), MATS.cucumberDark);
    const a = rand() * Math.PI * 0.9 + 0.1;
    bump.position.set(-0.8 + i * 0.32, 0.55 + Math.sin(a) * 0.52, Math.cos(a) * 0.52);
    g.add(bump);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 10), MATS.cut);
  cap.rotation.z = Math.PI / 2;
  cap.position.set(1.4, 0.55, 0);
  g.add(cap);
  g.rotation.y = rand() * Math.PI;
  return g;
}

interface Vacuum {
  mesh: THREE.Group;
  /** Road sample it patrols across. */
  index: number;
  phase: number;
  speed: number;
  pos: THREE.Vector3;
  lateral: number;
  dir: number;
}

interface Cucumber {
  pos: THREE.Vector3;
}

/**
 * Track obstacles that spin karts out on contact: robot vacuums that sweep across the
 * road on a timer, and cucumber patches guarding the inside of bends.
 */
export class TrackHazards {
  readonly group = new THREE.Group();
  private vacuums: Vacuum[] = [];
  private cucumbers: Cucumber[] = [];
  private patches = new THREE.Group();
  private time = 0;

  constructor(private track: Track, def: HazardDef | undefined, seed: number) {
    this.group.userData.dynamic = true;
    if (!def) return;
    let s = seed;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (const [n, t] of def.vacuums.entries()) {
      const mesh = vacuumMesh();
      this.group.add(mesh);
      this.vacuums.push({
        mesh,
        index: Math.floor(t * SAMPLES) % SAMPLES,
        phase: n * 2.1 + rand() * 3,
        speed: 0.55 + rand() * 0.25,
        pos: new THREE.Vector3(),
        lateral: 0,
        dir: 1,
      });
    }
    for (const t of def.cucumbers) this.addPatch(t, rand);
    // Cucumbers never move: draw them all in one go.
    mergeStatic(this.patches);
    this.group.add(this.patches);
    this.update(0);
  }

  /** Three cucumbers on the inside half of the bend at `t`, staggered so you can weave through. */
  private addPatch(t: number, rand: () => number): void {
    const pts = this.track.points;
    const tans = this.track.tangents;
    const i = Math.floor(t * SAMPLES) % SAMPLES;
    const a = tans[(i - 6 + SAMPLES) % SAMPLES];
    const b = tans[(i + 6) % SAMPLES];
    // Cross product sign: which side the road turns towards (the inside of the bend).
    const turn = a.x * b.z - a.z * b.x;
    const inside = turn > 0 ? -1 : 1; // in lateral (+right) terms
    for (const [along, lat] of [[-4, 2.2], [0, 5.2], [4, 1.2]] as const) {
      const k = (i + along + SAMPLES) % SAMPLES;
      const p = pts[k];
      const f = tans[k];
      const off = inside * (lat + rand() * 0.6);
      const pos = new THREE.Vector3(p.x + f.z * off, 0, p.z - f.x * off);
      const mesh = cucumberMesh(rand);
      mesh.position.copy(pos);
      this.patches.add(mesh);
      this.cucumbers.push({ pos });
    }
  }

  /** Frees GPU geometry when switching tracks (materials are shared). */
  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }

  /** Current obstacle positions, so AI drivers can steer around them. */
  get positions(): THREE.Vector3[] {
    return [...this.vacuums.map((v) => v.pos), ...this.cucumbers.map((c) => c.pos)];
  }

  /** Moves the vacuums. Runs every physics step (also during menus, for the look of it). */
  update(dt: number): void {
    this.time += dt;
    const pts = this.track.points;
    const tans = this.track.tangents;
    for (const v of this.vacuums) {
      // Smooth back-and-forth that lingers a moment at each kerb, like a real robot turning round.
      const w = Math.sin(this.time * v.speed + v.phase);
      const lateral = SWEEP * Math.max(-1, Math.min(1, w * 1.25));
      const moving = lateral - v.lateral;
      if (Math.abs(moving) > 1e-4) v.dir = Math.sign(moving);
      v.lateral = lateral;
      const p = pts[v.index];
      const f = tans[v.index];
      v.pos.set(p.x + f.z * lateral, 0, p.z - f.x * lateral);
      v.mesh.position.copy(v.pos);
      // Face the way it is travelling (across the road).
      v.mesh.rotation.y = Math.atan2(f.z * v.dir, -f.x * v.dir);
      for (const c of v.mesh.children) if (c.name === 'brush') c.rotation.y += dt * 14;
      const light = v.mesh.getObjectByName('light');
      if (light) light.visible = Math.sin(this.time * 6) > -0.3;
    }
  }

  /** Spins out any kart touching an obstacle. */
  collide(karts: KartPhysics[], radius: number): HazardHit[] {
    const hits: HazardHit[] = [];
    const check = (k: KartPhysics, pos: THREE.Vector3, r: number, kind: HazardKind) => {
      if (k.pos.y > 1.2) return; // jumped over it
      const dx = k.pos.x - pos.x;
      const dz = k.pos.z - pos.z;
      if (dx * dx + dz * dz > (r + radius) ** 2) return;
      if (k.invulnTime > 0 || k.starTime > 0) return;
      const shielded = k.shieldTime > 0;
      const hit = k.hit();
      if (hit || shielded) hits.push({ kart: k, kind, hit, at: pos.clone() });
    };
    for (const k of karts) {
      for (const v of this.vacuums) check(k, v.pos, VACUUM_R, 'vacuum');
      for (const c of this.cucumbers) check(k, c.pos, CUCUMBER_R, 'cucumber');
    }
    return hits;
  }
}
