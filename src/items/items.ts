import * as THREE from 'three';
import type { Racer } from '../race/racer';
import { SAMPLES, type Track } from '../world/track';

export type ItemKind = 'fish' | 'yarn' | 'banana';
export const ITEM_ICON: Record<ItemKind, string> = { fish: '🐟', yarn: '🧶', banana: '🍌' };
export const ITEM_NAME: Record<ItemKind, string> = { fish: '생선 부스트', yarn: '털실 뭉치', banana: '바나나' };

const ROULETTE_TIME = 1.2;
const BOX_RESPAWN = 3;
const BOX_ROWS = [0.06, 0.31, 0.58, 0.8];
const BOX_LANES = [-4.5, -1.5, 1.5, 4.5];
const YARN_SPEED = 46;
const YARN_LIFE = 7;
const BANANA_LIFE = 40;
const KART_HIT_RADIUS = 1.8;

/** Item odds by race position: leaders get defence, stragglers get speed. */
function rollItem(place: number, total: number): ItemKind {
  const t = total > 1 ? (place - 1) / (total - 1) : 0; // 0 = leader, 1 = last
  const fish = 0.1 + 0.5 * t;
  const banana = 0.6 - 0.55 * t;
  const r = Math.random();
  if (r < fish) return 'fish';
  if (r < fish + banana) return 'banana';
  return 'yarn';
}

interface Box {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  respawn: number;
}

interface Yarn {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  idx: number;
  owner: Racer;
  target: Racer | null;
  age: number;
  lane: number;
}

interface Banana {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  owner: Racer;
  age: number;
}

export type ItemEvent =
  | { type: 'hit'; victim: Racer; by: Racer; item: 'yarn' | 'banana' }
  | { type: 'got'; racer: Racer; item: ItemKind }
  | { type: 'used'; racer: Racer; item: ItemKind };

/** Per-racer item state lives on the Racer; this owns boxes and things on the track. */
export interface ItemHolder {
  item: ItemKind | null;
  roulette: number; // seconds left spinning; the item is decided when it ends
  itemHold: number; // how long the current item has been held (AI timing)
}

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, ...extra });

function boxTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, '#ff8fab');
  grad.addColorStop(0.5, '#c9a4ff');
  grad.addColorStop(1, '#9ad0ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 58, 58);
  g.fillStyle = '#fff';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', 32, 35);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function yarnMesh(): THREE.Group {
  const g = new THREE.Group();
  const m = mat(0xff5a8a);
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), m);
  g.add(ball);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 4, 12), mat(0xff8fab));
    ring.rotation.set(i * 1.1, i * 0.7, 0);
    g.add(ring);
  }
  g.children.forEach((c) => (c.castShadow = true));
  return g;
}

function bananaMesh(): THREE.Group {
  const g = new THREE.Group();
  const peel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.2, 5, 8, Math.PI * 0.9), mat(0xffd84d));
  peel.rotation.set(Math.PI / 2, 0, Math.PI * 0.05);
  peel.position.y = 0.2;
  g.add(peel);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 4), mat(0x6b4f3f));
  tip.position.set(0.55, 0.2, 0);
  g.add(tip);
  // floppy peel petals
  for (let i = 0; i < 3; i++) {
    const petal = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), mat(0xffe27a));
    petal.position.set(-0.5, 0.18, 0);
    petal.rotation.set(0, (i * Math.PI * 2) / 3, Math.PI / 2 + 0.6);
    g.add(petal);
  }
  g.children.forEach((c) => (c.castShadow = true));
  return g;
}

export class ItemSystem {
  readonly group = new THREE.Group();
  private boxes: Box[] = [];
  private yarns: Yarn[] = [];
  private bananas: Banana[] = [];
  private time = 0;

  constructor(private track: Track) {
    const geo = new THREE.BoxGeometry(1.8, 1.8, 1.8);
    const tex = boxTexture();
    // Self-lit so the boxes pop from a distance and in shadow.
    const boxMat = mat(0xffffff, { map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, transparent: true, opacity: 0.92 });
    for (const t of BOX_ROWS) {
      const i = Math.floor(t * SAMPLES) % SAMPLES;
      const p = track.points[i];
      const tan = track.tangents[i];
      for (const lane of BOX_LANES) {
        const pos = new THREE.Vector3(p.x + tan.z * lane, 0, p.z - tan.x * lane);
        pos.y = track.heightAt(pos.x, pos.z) + 1.3;
        const mesh = new THREE.Mesh(geo, boxMat);
        mesh.position.copy(pos);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boxes.push({ mesh, pos, respawn: 0 });
      }
    }
  }

  /** Positions of bananas, so AI can steer around them. */
  get hazards(): THREE.Vector3[] {
    return this.bananas.map((b) => b.pos);
  }

  clear(): void {
    for (const y of this.yarns) this.group.remove(y.mesh);
    for (const b of this.bananas) this.group.remove(b.mesh);
    this.yarns = [];
    this.bananas = [];
    for (const b of this.boxes) {
      b.respawn = 0;
      b.mesh.visible = true;
    }
  }

  /** Fire the held item. */
  use(r: Racer & ItemHolder, standings: Racer[]): ItemEvent | null {
    const item = r.item;
    if (!item || r.roulette > 0) return null;
    r.item = null;
    r.itemHold = 0;
    const k = r.physics;
    const f = k.forward;
    if (item === 'fish') {
      k.fishBoost();
    } else if (item === 'yarn') {
      // Homes in on the kart one place ahead, if there is one.
      const place = standings.indexOf(r);
      const target = place > 0 ? standings[place - 1] : null;
      const pos = k.pos.clone().addScaledVector(f, 2.5);
      const mesh = yarnMesh();
      mesh.position.copy(pos);
      this.group.add(mesh);
      const idx = this.track.nearest(pos.x, pos.z).index;
      const t = this.track.tangents[idx];
      const lane = (pos.x - this.track.points[idx].x) * t.z - (pos.z - this.track.points[idx].z) * t.x;
      this.yarns.push({ mesh, pos, idx, owner: r, target, age: 0, lane });
    } else {
      const pos = k.pos.clone().addScaledVector(f, -2.6);
      pos.y = this.track.heightAt(pos.x, pos.z);
      const mesh = bananaMesh();
      mesh.position.copy(pos);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(mesh);
      this.bananas.push({ mesh, pos, owner: r, age: 0 });
    }
    return { type: 'used', racer: r, item };
  }

  update(dt: number, racers: (Racer & ItemHolder)[], standings: Racer[]): ItemEvent[] {
    this.time += dt;
    const events: ItemEvent[] = [];

    // --- Boxes: spin, respawn, pick up ---
    for (const b of this.boxes) {
      if (b.respawn > 0) {
        b.respawn -= dt;
        b.mesh.visible = b.respawn <= 0;
        continue;
      }
      b.mesh.rotation.set(this.time * 0.9, this.time * 1.3, 0);
      b.mesh.position.y = b.pos.y + Math.sin(this.time * 3 + b.pos.x) * 0.15;
      for (const r of racers) {
        const p = r.physics.pos;
        if ((p.x - b.pos.x) ** 2 + (p.z - b.pos.z) ** 2 > 2.2 * 2.2) continue;
        b.respawn = BOX_RESPAWN;
        b.mesh.visible = false;
        if (!r.item && r.roulette <= 0) r.roulette = ROULETTE_TIME;
        break;
      }
    }

    // --- Roulette ---
    for (const r of racers) {
      if (r.roulette > 0) {
        r.roulette -= dt;
        if (r.roulette <= 0) {
          r.item = rollItem(standings.indexOf(r) + 1, standings.length);
          r.itemHold = 0;
          events.push({ type: 'got', racer: r, item: r.item });
        }
      } else if (r.item) r.itemHold += dt;
    }

    // --- Yarn balls: follow the road, home in on their target ---
    for (const y of [...this.yarns]) {
      y.age += dt;
      const near = this.track.nearestAround(y.pos.x, y.pos.z, y.idx, 10);
      y.idx = near.index;
      let aim: THREE.Vector3;
      const tp = y.target?.physics.pos;
      if (tp && tp.distanceToSquared(y.pos) < 35 * 35) {
        aim = tp;
      } else {
        // Drift towards the racing line while travelling along the track.
        y.lane *= Math.exp(-dt * 1.5);
        const ai = (y.idx + 6) % SAMPLES;
        const p = this.track.points[ai];
        const t = this.track.tangents[ai];
        aim = new THREE.Vector3(p.x + t.z * y.lane, 0, p.z - t.x * y.lane);
      }
      const dx = aim.x - y.pos.x;
      const dz = aim.z - y.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      y.pos.x += (dx / d) * YARN_SPEED * dt;
      y.pos.z += (dz / d) * YARN_SPEED * dt;
      y.pos.y = this.track.heightAt(y.pos.x, y.pos.z) + 0.75;
      y.mesh.position.copy(y.pos);
      y.mesh.rotation.x += dt * 14;
      y.mesh.rotation.y = Math.atan2(dx, dz);

      let gone = y.age > YARN_LIFE;
      for (const r of racers) {
        if (gone) break;
        if (r === y.owner && y.age < 0.6) continue;
        if (r.physics.pos.distanceToSquared(y.pos) < KART_HIT_RADIUS ** 2) {
          if (r.physics.hit()) events.push({ type: 'hit', victim: r, by: y.owner, item: 'yarn' });
          gone = true;
        }
      }
      // Yarn and bananas knock each other out.
      for (const b of [...this.bananas]) {
        if (gone) break;
        if (b.pos.distanceToSquared(y.pos) < 1.5 ** 2) {
          this.removeBanana(b);
          gone = true;
        }
      }
      if (gone) this.removeYarn(y);
    }

    // --- Bananas ---
    for (const b of [...this.bananas]) {
      b.age += dt;
      if (b.age > BANANA_LIFE) {
        this.removeBanana(b);
        continue;
      }
      for (const r of racers) {
        if (r === b.owner && b.age < 0.8) continue;
        if (r.physics.pos.distanceToSquared(b.pos) < 1.4 ** 2) {
          if (r.physics.hit()) events.push({ type: 'hit', victim: r, by: b.owner, item: 'banana' });
          this.removeBanana(b);
          break;
        }
      }
    }
    return events;
  }

  /** Decides whether an AI racer should fire its item now. */
  aiWantsToUse(r: Racer & ItemHolder, standings: Racer[]): boolean {
    if (!r.item || r.roulette > 0 || r.physics.spinTime > 0) return false;
    const place = standings.indexOf(r);
    const myDist = r.tracker.distance;
    if (r.item === 'fish') return r.itemHold > 0.6 && !r.physics.offroad;
    if (r.item === 'yarn') {
      const ahead = place > 0 ? standings[place - 1] : null;
      const gap = ahead ? ahead.tracker.distance - myDist : Infinity;
      return (gap > 2 && gap < 30 && r.itemHold > 0.5) || r.itemHold > 6;
    }
    const behind = standings[place + 1];
    const gap = behind ? myDist - behind.tracker.distance : Infinity;
    return (gap > 0 && gap < 10 && r.itemHold > 0.5) || r.itemHold > 7;
  }

  private removeYarn(y: Yarn): void {
    this.group.remove(y.mesh);
    this.yarns.splice(this.yarns.indexOf(y), 1);
  }

  private removeBanana(b: Banana): void {
    this.group.remove(b.mesh);
    this.bananas.splice(this.bananas.indexOf(b), 1);
  }
}
