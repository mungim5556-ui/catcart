import * as THREE from 'three';
import type { KartPhysics } from '../kart/kartPhysics';
import { ROAD_WIDTH, SAMPLES, type Track } from './track';
import { mergeStatic } from './mergeStatic';

/**
 * Themed track obstacles. Every kind spins a kart out on contact, but each moves its own way:
 *  - sweepers cross the road from kerb to kerb (🤖 🦀 ☃️ 🦔)
 *  - poppers sit on the road and burst open on a 3 s timer, one after another (🌸 ♨️ 🍄)
 *  - fliers wander around a spot, dipping low now and then (🦋 🌪️)
 *  - bouncers hop up and down, safe to pass under while high (🏐)
 *  - patches guard the inside of tight bends (🐧 🌵)
 */
export type HazardKind =
  | 'butterfly'
  | 'flower'
  | 'crab'
  | 'beachball'
  | 'snowball'
  | 'penguin'
  | 'vacuum'
  | 'steam'
  | 'hedgehog'
  | 'mushroom'
  | 'dustdevil'
  | 'cactus';

/** Where a track's obstacles go: kind → positions along the lap (0..1). */
export type HazardDef = Partial<Record<HazardKind, number[]>>;

export const HAZARD_INFO: Record<HazardKind, { ouch: string; colors: [number, number] }> = {
  butterfly: { ouch: '🦋 나비다! 앞이 안 보여!', colors: [0xffa6d9, 0xa6e3ff] },
  flower: { ouch: '🌸 꽃이 활짝! 에취!', colors: [0xff8fb8, 0xfff27a] },
  crab: { ouch: '🦀 꽃게한테 집혔다!', colors: [0xff5a4a, 0xffffff] },
  beachball: { ouch: '🏐 비치볼에 퉁!', colors: [0xffd84d, 0x4fc3ff] },
  snowball: { ouch: '☃️ 눈덩이에 쾅!', colors: [0xffffff, 0xcfe8ff] },
  penguin: { ouch: '🐧 펭귄이랑 꽈당!', colors: [0x2b2d42, 0xffffff] },
  vacuum: { ouch: '🤖 청소기다! 으악!', colors: [0xffffff, 0x9aa3b5] },
  steam: { ouch: '♨️ 뜨거운 김! 앗뜨!', colors: [0xffffff, 0xd0d6e0] },
  hedgehog: { ouch: '🦔 고슴도치 따끔!', colors: [0x8a5a3a, 0xf3d9b1] },
  mushroom: { ouch: '🍄 포자 뿜뿜! 에취!', colors: [0xc8f06a, 0xfff6a0] },
  dustdevil: { ouch: '🌪️ 회오리에 빙글빙글!', colors: [0xe8c58a, 0xfff0d0] },
  cactus: { ouch: '🌵 선인장 따끔!', colors: [0x5fa845, 0xfff0a0] },
};

export interface HazardHit {
  kart: KartPhysics;
  kind: HazardKind;
  /** false when a 📦 shield soaked it up. */
  hit: boolean;
  at: THREE.Vector3;
}

/** One obstacle, however it moves. */
interface Hazard {
  kind: HazardKind;
  obj: THREE.Object3D;
  /** Centre on the ground plane; y is the altitude of its underside. */
  pos: THREE.Vector3;
  /** Current collision radius (0 = harmless right now). */
  radius: number;
  /** How tall it is above `pos.y` (a jumping kart clears it). */
  height: number;
  /** AI should steer around it right now. */
  threat: boolean;
  update(time: number, dt: number): void;
}

const SWEEP = ROAD_WIDTH / 2 - 1.2;
const POP_PERIOD = 3;

// ---------- materials & mesh helpers ----------

const cache = new Map<string, THREE.Material>();
function mat(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(extra);
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6, ...extra });
    cache.set(key, m);
  }
  return m;
}
const glow = (color: number) => mat(color, { emissive: color, emissiveIntensity: 0.8 });
const soft = (color: number, opacity: number) => mat(color, { transparent: true, opacity, depthWrite: false, roughness: 1 });

function m(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** Marks a part that animates, so compaction leaves it separate. */
function live<T extends THREE.Object3D>(o: T, name: string): T {
  o.name = name;
  o.userData.dynamic = true;
  return o;
}

/** Merges the non-animated parts of one obstacle by material (fewer draw calls). */
function compact(g: THREE.Group): THREE.Group {
  mergeStatic(g);
  return g;
}

const eyes = (g: THREE.Group, y: number, z: number, spread: number, size = 0.16) => {
  for (const s of [-1, 1]) {
    g.add(m(new THREE.SphereGeometry(size, 8, 6), mat(0x1d1d28), s * spread, y, z));
    g.add(m(new THREE.SphereGeometry(size * 0.35, 6, 4), glow(0xffffff), s * spread + size * 0.3, y + size * 0.35, z + size * 0.8));
  }
};

// ---------- meshes ----------

function vacuumMesh(): THREE.Group {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(1.8, 1.8, 0.7, 18), mat(0xff7aa2), 0, 0.45));
  g.add(m(new THREE.CylinderGeometry(1.88, 1.88, 0.3, 18, 1, true, -1.3, 2.6), mat(0x3a3d4a), 0, 0.4));
  g.add(m(new THREE.CylinderGeometry(1.2, 1.3, 0.14, 16), mat(0xfff4f8), 0, 0.86));
  g.add(live(m(new THREE.SphereGeometry(0.2, 8, 6), glow(0x49e27a), 0, 0.95, -0.55), 'blink'));
  eyes(g, 0.62, 1.72, 0.55, 0.28);
  for (const side of [-1, 1]) {
    const brush = live(new THREE.Group(), 'spin');
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i / 3) * Math.PI * 2;
      arm.add(m(new THREE.BoxGeometry(0.08, 0.04, 0.75), mat(0x9aa3b5), 0, 0, 0.35));
      brush.add(arm);
    }
    brush.position.set(side * 1.1, 0.1, 1.2);
    g.add(brush);
  }
  return compact(g);
}

function crabMesh(): THREE.Group {
  const g = new THREE.Group();
  const red = mat(0xff5a4a);
  const body = m(new THREE.SphereGeometry(1.1, 10, 7), red, 0, 0.9);
  body.scale.set(1.3, 0.6, 1);
  g.add(body);
  eyes(g, 1.75, 0.55, 0.4, 0.2);
  for (const s of [-1, 1]) {
    g.add(m(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 5), red, s * 0.4, 1.4, 0.5));
    // Big claws raised up front, snapping.
    const claw = live(new THREE.Group(), 'claw');
    claw.add(m(new THREE.SphereGeometry(0.5, 8, 6), red, 0, 0, 0));
    claw.add(m(new THREE.ConeGeometry(0.22, 0.6, 5), mat(0xffb3a6), 0, 0.45, 0.1));
    claw.position.set(s * 1.3, 1.5, 0.8);
    claw.userData.side = s;
    g.add(claw);
    for (let i = 0; i < 3; i++) {
      const leg = m(new THREE.BoxGeometry(0.9, 0.12, 0.12), red, s * 1.5, 0.45, -0.4 + i * 0.4);
      leg.rotation.z = s * -0.5;
      g.add(leg);
    }
  }
  return compact(g);
}

function snowballMesh(): THREE.Group {
  const g = new THREE.Group();
  const ball = live(new THREE.Group(), 'roll');
  ball.add(m(new THREE.IcosahedronGeometry(1.9, 1), mat(0xffffff, { roughness: 0.9 })));
  // Twigs and pebbles stuck in it make the rolling visible.
  for (const [x, y, z] of [[1.7, 0.6, 0.3], [-0.8, 1.6, -0.6], [0.2, -1.2, 1.4], [-1.2, -0.5, -1.3]]) {
    ball.add(m(new THREE.DodecahedronGeometry(0.28), mat(0x6b5a4a), x, y, z));
  }
  ball.position.y = 1.9;
  g.add(ball);
  return g;
}

function hedgehogMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = m(new THREE.SphereGeometry(1.2, 10, 8), mat(0x7a4f33), 0, 0.95);
  body.scale.set(1, 0.85, 1.25);
  g.add(body);
  const spike = mat(0x4a2f1e);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 * 3.3;
    const b = 0.35 + (i / 22) * 1.1;
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(b), Math.cos(b), -Math.abs(Math.sin(a)) * Math.sin(b) - 0.2).normalize();
    const c = m(new THREE.ConeGeometry(0.18, 0.8, 4), spike, dir.x * 1.1, 0.95 + dir.y * 0.95, dir.z * 1.3);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.add(c);
  }
  const face = m(new THREE.ConeGeometry(0.55, 1.0, 7), mat(0xf3d9b1), 0, 0.8, 1.35);
  face.rotation.x = Math.PI / 2;
  g.add(face);
  g.add(m(new THREE.SphereGeometry(0.14, 6, 5), mat(0x1d1d28), 0, 0.8, 1.9));
  eyes(g, 1.05, 1.3, 0.28, 0.12);
  return compact(g);
}

function butterflyMesh(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const palette = [0xff8fd0, 0x8fd8ff, 0xffd84d, 0xb58fff, 0xff9f5a];
  const wingMat = mat(palette[Math.floor(rand() * palette.length)], { side: THREE.DoubleSide, emissive: 0x222222 });
  const spotMat = mat(0xffffff, { side: THREE.DoubleSide });
  const body = m(new THREE.CapsuleGeometry(0.12, 0.9, 3, 6), mat(0x2b2d42));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  for (const s of [-1, 1]) {
    const wing = live(new THREE.Group(), 'wing');
    wing.userData.side = s;
    const upper = new THREE.Mesh(new THREE.CircleGeometry(0.85, 7), wingMat);
    upper.scale.set(1.2, 1, 1);
    upper.rotation.x = -Math.PI / 2;
    upper.position.set(s * 0.95, 0, 0.3);
    const lower = new THREE.Mesh(new THREE.CircleGeometry(0.55, 6), wingMat);
    lower.rotation.x = -Math.PI / 2;
    lower.position.set(s * 0.65, 0, -0.45);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.22, 6), spotMat);
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(s * 1.1, 0.01, 0.35);
    wing.add(upper, lower, spot);
    g.add(wing);
  }
  for (const s of [-1, 1]) {
    const ant = m(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4), mat(0x2b2d42), s * 0.12, 0.2, 0.75);
    ant.rotation.x = 0.9;
    ant.rotation.z = -s * 0.3;
    g.add(ant);
  }
  // Big enough to spot from behind at speed.
  g.scale.setScalar(1.7);
  return g;
}

function flowerMesh(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const colors = [0xff7aa8, 0xffa94d, 0xc58bff, 0xff5a6e];
  const petalMat = mat(colors[Math.floor(rand() * colors.length)]);
  g.add(m(new THREE.CylinderGeometry(0.12, 0.16, 1.1, 6), mat(0x4f9a3a), 0, 0.55));
  for (const s of [-1, 1]) {
    const leaf = m(new THREE.SphereGeometry(0.35, 6, 4), mat(0x5fb848), s * 0.35, 0.3, 0);
    leaf.scale.set(1.4, 0.3, 0.7);
    g.add(leaf);
  }
  const head = live(new THREE.Group(), 'head');
  head.position.y = 1.15;
  head.add(m(new THREE.SphereGeometry(0.42, 8, 6), mat(0xffe066), 0, 0.05, 0));
  for (let i = 0; i < 7; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 7) * Math.PI * 2;
    const petal = m(new THREE.SphereGeometry(0.55, 7, 5), petalMat, 0, 0, 0.9);
    petal.scale.set(0.8, 0.25, 1.4);
    pivot.add(petal);
    pivot.name = 'petal';
    head.add(pivot);
  }
  g.add(head);
  return compact(g);
}

function steamMesh(): THREE.Group {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(1.2, 1.2, 0.08, 14), mat(0x3a3d4a), 0, 0.04));
  // Glowing warning ring so the manhole shows up on the dark street.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.12, 4, 18), glow(0xff9f1c));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  for (let i = 0; i < 4; i++) {
    const bar = m(new THREE.BoxGeometry(2.0, 0.1, 0.12), mat(0x23252f), 0, 0.09, -0.6 + i * 0.4);
    g.add(bar);
  }
  const plume = live(new THREE.Group(), 'plume');
  for (let i = 0; i < 6; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + i * 0.25, 1), soft(0xf4f6fa, 0.75));
    puff.position.set(Math.sin(i * 2.1) * 0.4, 0.6 + i * 0.9, Math.cos(i * 1.7) * 0.4);
    plume.add(puff);
  }
  g.add(plume);
  return compact(g);
}

function mushroomMesh(): THREE.Group {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.4, 0.55, 1.2, 8), mat(0xfff4e0), 0, 0.6));
  const cap = live(new THREE.Group(), 'cap');
  cap.position.y = 1.2;
  const top = m(new THREE.SphereGeometry(1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe63946));
  cap.add(top);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cap.add(m(new THREE.SphereGeometry(0.17, 6, 4), mat(0xffffff), Math.cos(a) * 0.7, 0.72, Math.sin(a) * 0.7));
  }
  cap.add(m(new THREE.SphereGeometry(0.2, 6, 4), mat(0xffffff), 0, 1.1, 0));
  g.add(cap);
  const cloud = live(new THREE.Group(), 'cloud');
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), soft(0xd4f57a, 0.6));
    puff.position.set(Math.cos(a) * 1.3, 0.9 + (i % 2) * 0.6, Math.sin(a) * 1.3);
    cloud.add(puff);
  }
  g.add(cloud);
  return compact(g);
}

function beachballMesh(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1.3, 12, 8);
  const colors: number[] = [];
  const stripes = [0xff5a6e, 0xffffff, 0xffd84d, 0xffffff, 0x4fc3ff, 0xffffff];
  const p = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i)) + Math.PI;
    c.setHex(stripes[Math.floor((a / (Math.PI * 2)) * stripes.length) % stripes.length]);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const ball = live(m(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })), 'ball');
  g.add(ball);
  // Shadow disc on the sand shows where it will land.
  const shadow = live(new THREE.Mesh(new THREE.CircleGeometry(1.3, 14), soft(0x000000, 0.25)), 'shadow');
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  g.add(shadow);
  return g;
}

function dustDevilMesh(): THREE.Group {
  const g = new THREE.Group();
  const swirl = live(new THREE.Group(), 'swirl');
  for (let i = 0; i < 6; i++) {
    const r = 0.7 + i * 0.45;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.25 + i * 0.05, 5, 10, Math.PI * 1.5), soft(i % 2 ? 0xe8c58a : 0xd9ab5e, 0.7));
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = i * 1.3;
    ring.position.y = 0.4 + i * 0.95;
    swirl.add(ring);
  }
  for (let i = 0; i < 8; i++) {
    const grit = new THREE.Mesh(new THREE.TetrahedronGeometry(0.18), mat(0xb88a4a));
    grit.position.set(Math.cos(i) * (1 + (i % 3) * 0.8), 0.5 + i * 0.6, Math.sin(i) * (1 + (i % 3) * 0.8));
    swirl.add(grit);
  }
  g.add(swirl);
  return g;
}

function penguinMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = live(new THREE.Group(), 'waddle');
  const torso = m(new THREE.CapsuleGeometry(0.6, 0.8, 4, 8), mat(0x2b2d42), 0, 1.0);
  body.add(torso);
  const belly = m(new THREE.SphereGeometry(0.52, 8, 6), mat(0xffffff), 0, 0.95, 0.3);
  belly.scale.set(0.95, 1.4, 0.75);
  body.add(belly);
  const beak = m(new THREE.ConeGeometry(0.14, 0.35, 5), mat(0xffa629), 0, 1.55, 0.65);
  beak.rotation.x = Math.PI / 2;
  body.add(beak);
  eyes(body as THREE.Group, 1.72, 0.5, 0.2, 0.1);
  for (const s of [-1, 1]) {
    const flipper = m(new THREE.BoxGeometry(0.12, 0.7, 0.35), mat(0x2b2d42), s * 0.65, 1.0, 0);
    flipper.rotation.z = s * 0.35;
    body.add(flipper);
    body.add(m(new THREE.BoxGeometry(0.3, 0.1, 0.45), mat(0xffa629), s * 0.25, 0.05, 0.2));
  }
  mergeStatic(body);
  g.add(body);
  return g;
}

function cactusMesh(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const green = mat(0x4f9a3a);
  g.add(m(new THREE.CylinderGeometry(0.5, 0.55, 3.2, 8), green, 0, 1.6));
  g.add(m(new THREE.SphereGeometry(0.5, 8, 5), green, 0, 3.2));
  for (const s of [-1, 1]) {
    const h = 1.2 + rand() * 0.8;
    const arm = m(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 7), green, s * 0.75, h, 0);
    arm.rotation.z = Math.PI / 2;
    g.add(arm);
    g.add(m(new THREE.CylinderGeometry(0.3, 0.3, 1.1, 7), green, s * 1.05, h + 0.55, 0));
    g.add(m(new THREE.SphereGeometry(0.3, 7, 4), green, s * 1.05, h + 1.1, 0));
  }
  g.add(m(new THREE.SphereGeometry(0.2, 6, 4), mat(0xff7aa8), 0, 3.6, 0));
  g.rotation.y = rand() * Math.PI;
  return g;
}

// ---------- behaviours ----------

interface Frame {
  p: THREE.Vector3;
  /** Road forward. */
  f: THREE.Vector3;
}

/** Road position at `frame`, `lat` metres to the right and `along` metres forward. */
function place(out: THREE.Vector3, { p, f }: Frame, lat: number, along = 0): THREE.Vector3 {
  return out.set(p.x + f.x * along + f.z * lat, 0, p.z + f.z * along - f.x * lat);
}

/**
 * Track obstacles that spin karts out on contact; which ones a track gets comes from its
 * `hazards` definition.
 */
export class TrackHazards {
  readonly group = new THREE.Group();
  private list: Hazard[] = [];
  /** Things that never move, drawn as one batch. */
  private statics = new THREE.Group();
  private time = 0;
  private rand: () => number;

  constructor(private track: Track, def: HazardDef | undefined, seed: number) {
    this.group.userData.dynamic = true;
    let s = seed;
    this.rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (const [kind, spots] of Object.entries(def ?? {}) as [HazardKind, number[]][]) {
      for (const [n, t] of spots.entries()) this.spawn(kind, this.frame(t), n);
    }
    mergeStatic(this.statics);
    this.group.add(this.statics);
    this.update(0);
  }

  private frame(t: number, offset = 0): Frame {
    const i = (Math.floor(t * SAMPLES) + offset + SAMPLES) % SAMPLES;
    return { p: this.track.points[i], f: this.track.tangents[i] };
  }

  private add(h: Hazard): void {
    this.list.push(h);
    this.group.add(h.obj);
  }

  private spawn(kind: HazardKind, fr: Frame, n: number): void {
    const rand = this.rand;
    switch (kind) {
      case 'vacuum':
      case 'crab':
      case 'snowball':
      case 'hedgehog':
        return this.sweeper(kind, fr, n);
      case 'flower':
      case 'steam':
      case 'mushroom':
        // A staggered row across the road; they burst open one after another.
        for (const [k, [lat, along]] of ([[-5, -9], [0, 0], [5, 9]] as const).entries()) {
          this.popper(kind, fr, lat * (n % 2 ? -1 : 1), along, (k * POP_PERIOD) / 3 + rand() * 0.2);
        }
        return;
      case 'butterfly':
        for (let k = 0; k < 2; k++) this.flier('butterfly', fr, rand() * 10);
        return;
      case 'dustdevil':
        return this.flier('dustdevil', fr, rand() * 10);
      case 'beachball':
        for (const lat of [-3.5, 3.5]) this.bouncer(fr, lat, rand() * 3);
        return;
      case 'penguin':
      case 'cactus':
        return this.patch(kind, fr);
    }
  }

  /** Crosses the road from kerb to kerb, pausing briefly at each side. */
  private sweeper(kind: 'vacuum' | 'crab' | 'snowball' | 'hedgehog', fr: Frame, n: number): void {
    const obj = kind === 'vacuum' ? vacuumMesh() : kind === 'crab' ? crabMesh() : kind === 'snowball' ? snowballMesh() : hedgehogMesh();
    const radius = { vacuum: 1.8, crab: 1.6, snowball: 1.9, hedgehog: 1.4 }[kind];
    const speed = { vacuum: 0.6, crab: 0.8, snowball: 0.5, hedgehog: 0.65 }[kind] * (0.9 + this.rand() * 0.25);
    const phase = n * 2.1 + this.rand() * 3;
    const roll = obj.getObjectByName('roll');
    const spin = obj.children.filter((c) => c.name === 'spin');
    const claws = obj.children.filter((c) => c.name === 'claw');
    const blink = obj.getObjectByName('blink');
    const axis = new THREE.Vector3(fr.f.x, 0, fr.f.z);
    let lastLat = 0;
    let dir = 1;
    const h: Hazard = {
      kind, obj, radius, height: kind === 'snowball' ? 3.8 : 2,
      pos: new THREE.Vector3(), threat: true,
      update: (time, dt) => {
        const lat = SWEEP * Math.max(-1, Math.min(1, Math.sin(time * speed + phase) * 1.25));
        if (Math.abs(lat - lastLat) > 1e-4) dir = Math.sign(lat - lastLat);
        lastLat = lat;
        place(h.pos, fr, lat);
        obj.position.copy(h.pos);
        const across = Math.atan2(fr.f.z * dir, -fr.f.x * dir);
        if (kind === 'crab') {
          // Crabs face the traffic and scuttle sideways.
          obj.rotation.y = Math.atan2(-fr.f.x, -fr.f.z);
          obj.position.y = Math.abs(Math.sin(time * 14)) * 0.12;
          for (const c of claws) c.rotation.x = Math.sin(time * 8 + c.userData.side) * 0.5 - 0.3;
        } else if (kind === 'snowball' && roll) {
          // Roll about the road's forward axis by the distance travelled.
          roll.quaternion.setFromAxisAngle(axis, -lat / 1.9);
        } else {
          obj.rotation.y = across;
          if (kind === 'hedgehog') obj.position.y = Math.abs(Math.sin(time * 10)) * 0.15;
        }
        for (const c of spin) c.rotation.y += dt * 14;
        if (blink) blink.visible = Math.sin(time * 6) > -0.3;
      },
    };
    this.add(h);
  }

  /** Sits on the road and bursts open for about a second every POP_PERIOD seconds. */
  private popper(kind: 'flower' | 'steam' | 'mushroom', fr: Frame, lat: number, along: number, phase: number): void {
    const obj = kind === 'flower' ? flowerMesh(this.rand) : kind === 'steam' ? steamMesh() : mushroomMesh();
    const closedR = { flower: 0.35, steam: 0, mushroom: 0.5 }[kind];
    const openR = { flower: 1.9, steam: 1.8, mushroom: 2.0 }[kind];
    const head = obj.getObjectByName('head');
    const petals = head?.children.filter((c) => c.name === 'petal') ?? [];
    const plume = obj.getObjectByName('plume');
    const cap = obj.getObjectByName('cap');
    const cloud = obj.getObjectByName('cloud');
    const pos = place(new THREE.Vector3(), fr, lat, along);
    obj.position.copy(pos);
    obj.rotation.y = this.rand() * Math.PI * 2;
    const h: Hazard = {
      kind, obj, pos, radius: closedR, height: kind === 'steam' ? 6 : 2.5, threat: true,
      update: (time) => {
        const c = (((time + phase) % POP_PERIOD) + POP_PERIOD) % POP_PERIOD;
        // 0 → 0.2 s burst open, hold until 1.1 s, close by 1.4 s.
        const open = c < 0.2 ? c / 0.2 : c < 1.1 ? 1 : c < 1.4 ? 1 - (c - 1.1) / 0.3 : 0;
        const warn = c > POP_PERIOD - 0.7 ? Math.sin(time * 40) * 0.08 : 0; // shivers just before
        h.radius = closedR + (openR - closedR) * open;
        h.threat = open > 0 || c > POP_PERIOD - 0.8;
        if (kind === 'flower' && head) {
          const s = 0.55 + open * 1.25;
          head.scale.setScalar(s);
          head.rotation.z = warn;
          for (const p of petals) p.rotation.x = -1.2 + open * 0.9; // folded into a bud when closed, a cup when open
        } else if (kind === 'steam' && plume) {
          plume.visible = open > 0.02;
          plume.scale.set(0.4 + open * 0.8, 0.2 + open, 0.4 + open * 0.8);
          plume.rotation.y = time * 2;
          obj.position.y = warn ? Math.abs(warn) * 0.5 : 0;
        } else if (cap && cloud) {
          cap.scale.set(1 - open * 0.15 + warn, 1 + open * 0.2 - warn, 1 - open * 0.15 + warn);
          cloud.visible = open > 0.02;
          cloud.scale.setScalar(0.3 + open * 1.1);
          cloud.rotation.y = time;
        }
      },
    };
    this.add(h);
  }

  /** Wanders around a spot. Butterflies flutter up and down (safe while high); dust devils stay low. */
  private flier(kind: 'butterfly' | 'dustdevil', fr: Frame, phase: number): void {
    const obj = kind === 'butterfly' ? butterflyMesh(this.rand) : dustDevilMesh();
    const wings = obj.children.filter((c) => c.name === 'wing');
    const swirl = obj.getObjectByName('swirl');
    const reach = kind === 'butterfly' ? { lat: 6, along: 8 } : { lat: 5.5, along: 10 };
    const prev = new THREE.Vector3();
    const h: Hazard = {
      kind, obj, radius: kind === 'butterfly' ? 1.4 : 2.2, height: kind === 'butterfly' ? 1.2 : 7, pos: new THREE.Vector3(), threat: true,
      update: (time, dt) => {
        const t = time + phase;
        const k = kind === 'butterfly' ? 1 : 0.6;
        prev.copy(h.pos);
        place(h.pos, fr, Math.sin(t * 0.7 * k) * reach.lat, Math.sin(t * 0.45 * k + 1) * reach.along);
        if (kind === 'butterfly') {
          // Dips down to kart height every few seconds.
          h.pos.y = 0.2 + 2.4 * (0.5 + 0.5 * Math.sin(t * 1.1));
          h.threat = h.pos.y < 1.8;
          // Wings in a V that flaps, so they read from behind too (flat wings vanish edge-on).
          for (const w of wings) w.rotation.z = w.userData.side * (0.55 + Math.sin(t * 16) * 0.55);
        } else if (swirl) swirl.rotation.y -= dt * 9;
        obj.position.copy(h.pos);
        if (kind === 'butterfly') obj.position.y += 0.5;
        const dx = h.pos.x - prev.x;
        const dz = h.pos.z - prev.z;
        if (dx * dx + dz * dz > 1e-6 && kind === 'butterfly') obj.rotation.y = Math.atan2(dx, dz);
      },
    };
    this.add(h);
  }

  /** Bounces up and down while drifting slowly across the road; pass under it while it's high. */
  private bouncer(fr: Frame, lat0: number, phase: number): void {
    const obj = beachballMesh();
    const ball = obj.getObjectByName('ball')!;
    const shadow = obj.getObjectByName('shadow')!;
    const h: Hazard = {
      kind: 'beachball', obj, radius: 1.5, height: 2.6, pos: new THREE.Vector3(), threat: true,
      update: (time) => {
        const t = time + phase;
        place(h.pos, fr, lat0 + Math.sin(t * 0.4) * 3, 0);
        const y = 4.5 * Math.abs(Math.sin((t * Math.PI) / 1.6));
        h.pos.y = y;
        h.threat = y < 2.5;
        obj.position.set(h.pos.x, 0, h.pos.z);
        ball.position.y = y + 1.3;
        ball.rotation.x = t * 3;
        // Squash on landing.
        ball.scale.set(1 + Math.max(0, 0.4 - y) * 0.5, 1 - Math.max(0, 0.4 - y) * 0.6, 1 + Math.max(0, 0.4 - y) * 0.5);
        shadow.scale.setScalar(1 - Math.min(0.5, y / 9));
      },
    };
    this.add(h);
  }

  /** Three of them on the inside half of the bend, staggered so you can weave through. */
  private patch(kind: 'penguin' | 'cactus', fr: Frame): void {
    const i = this.track.points.indexOf(fr.p);
    const tans = this.track.tangents;
    const a = tans[(i - 6 + SAMPLES) % SAMPLES];
    const b = tans[(i + 6) % SAMPLES];
    const inside = a.x * b.z - a.z * b.x > 0 ? -1 : 1; // lateral sign of the inside of the bend
    for (const [along, lat] of [[-10, 3.4], [0, 6], [10, 2.4]] as const) {
      const pos = place(new THREE.Vector3(), fr, inside * (lat + this.rand() * 0.6), along);
      if (kind === 'cactus') {
        const obj = cactusMesh(this.rand);
        obj.position.copy(pos);
        this.statics.add(obj);
        this.list.push({ kind, obj, pos, radius: 1.0, height: 4, threat: true, update: () => {} });
      } else {
        const obj = penguinMesh();
        const body = obj.getObjectByName('waddle')!;
        const phase = this.rand() * 6;
        obj.position.copy(pos);
        obj.rotation.y = Math.atan2(-fr.f.x, -fr.f.z) + (this.rand() - 0.5);
        this.add({
          kind, obj, pos, radius: 1.0, height: 2, threat: true,
          update: (time) => {
            body.rotation.z = Math.sin(time * 5 + phase) * 0.18;
            body.position.y = Math.abs(Math.sin(time * 5 + phase)) * 0.08;
          },
        });
      }
    }
  }

  /** Frees GPU geometry when switching tracks (materials are shared). */
  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }

  /** Obstacles the AI should currently steer around. */
  get positions(): THREE.Vector3[] {
    return this.list.filter((h) => h.threat).map((h) => h.pos);
  }

  /** Animates everything. Runs every physics step. */
  update(dt: number): void {
    this.time += dt;
    for (const h of this.list) h.update(this.time, dt);
  }

  /** Spins out any kart touching an obstacle. */
  collide(karts: KartPhysics[], radius: number): HazardHit[] {
    const hits: HazardHit[] = [];
    for (const k of karts) {
      if (k.invulnTime > 0 || k.starTime > 0) continue;
      for (const h of this.list) {
        if (h.radius <= 0) continue;
        // Kart body spans roughly y .. y+1.3; the obstacle spans pos.y .. pos.y+height.
        if (k.pos.y > h.pos.y + h.height || k.pos.y + 1.3 < h.pos.y) continue;
        const dx = k.pos.x - h.pos.x;
        const dz = k.pos.z - h.pos.z;
        if (dx * dx + dz * dz > (h.radius + radius) ** 2) continue;
        const shielded = k.shieldTime > 0;
        const hit = k.hit();
        if (hit || shielded) hits.push({ kart: k, kind: h.kind, hit, at: h.pos.clone() });
        break;
      }
    }
    return hits;
  }
}
