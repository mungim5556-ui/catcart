import * as THREE from 'three';
import type { Racer } from '../race/racer';
import { SAMPLES, type Track } from '../world/track';

export type ItemKind = 'fish' | 'fish3' | 'yarn' | 'mouse' | 'banana' | 'milk' | 'box' | 'catnip' | 'bath';
/** Items that can knock a kart about. */
export type HitItem = 'yarn' | 'mouse' | 'banana' | 'milk' | 'bath' | 'catnip';

export const ITEM_ICON: Record<ItemKind, string> = {
  fish: '🐟',
  fish3: '🐟',
  yarn: '🧶',
  mouse: '🐭',
  banana: '🍌',
  milk: '🥛',
  box: '📦',
  catnip: '🌿',
  bath: '💦',
};
export const ITEM_NAME: Record<ItemKind, string> = {
  fish: '생선 부스트',
  fish3: '생선 3마리',
  yarn: '털실 뭉치',
  mouse: '태엽 쥐',
  banana: '바나나',
  milk: '우유 웅덩이',
  box: '상자 방패',
  catnip: '캣닢',
  bath: '목욕 시간',
};

const ROULETTE_TIME = 1.2;
const BOX_RESPAWN = 3;
const BOX_LANES = [-4.5, -1.5, 1.5, 4.5];
const YARN_SPEED = 46;
const YARN_LIFE = 7;
const BANANA_LIFE = 40;
const MOUSE_SPEED = 40;
const MOUSE_LIFE = 6;
const MILK_RADIUS = 2.7;
const MILK_LIFE = 8;
const KART_HIT_RADIUS = 1.8;

/**
 * Item odds by race position [leader, middle of the pack, last].
 * Leaders get defence; stragglers get catch-up power.
 */
const ODDS: Record<ItemKind, [number, number, number]> = {
  fish: [10, 15, 12],
  fish3: [0, 10, 25],
  yarn: [5, 20, 15],
  mouse: [20, 15, 5],
  banana: [30, 10, 0],
  milk: [15, 10, 0],
  box: [20, 12, 5],
  catnip: [0, 5, 23],
  bath: [0, 3, 15],
};

function rollItem(place: number, total: number): ItemKind {
  const t = total > 1 ? (place - 1) / (total - 1) : 0; // 0 = leader, 1 = last
  const [a, b, u] = t < 0.5 ? [0, 1, t * 2] : [1, 2, (t - 0.5) * 2];
  const kinds = Object.keys(ODDS) as ItemKind[];
  const weights = kinds.map((k) => ODDS[k][a] + (ODDS[k][b] - ODDS[k][a]) * u);
  let r = Math.random() * weights.reduce((x, y) => x + y, 0);
  for (let i = 0; i < kinds.length; i++) if ((r -= weights[i]) <= 0) return kinds[i];
  return 'fish';
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

interface Mouse {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  idx: number;
  lane: number; // keeps the sideways offset it was fired at
  owner: Racer;
  age: number;
}

/** Milk puddles reuse the banana shape: a spot on the road with an owner and an age. */
type Puddle = Banana;

export type ItemEvent =
  | { type: 'hit'; victim: Racer; by: Racer; item: HitItem }
  | { type: 'blocked'; racer: Racer }
  | { type: 'got'; racer: Racer; item: ItemKind }
  | { type: 'used'; racer: Racer; item: ItemKind };

/** Per-racer item state lives on the Racer; this owns boxes and things on the track. */
export interface ItemHolder {
  item: ItemKind | null;
  /** Uses left of the held item (🐟×3 starts at 3). */
  itemUses: number;
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

function mouseMesh(): THREE.Group {
  const g = new THREE.Group();
  const grey = mat(0x9a96a8);
  const pink = mat(0xff9eb5);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), grey);
  body.scale.set(0.8, 0.7, 1.2);
  g.add(body);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 6), grey);
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0.05, 0.75);
  g.add(head);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), pink);
  nose.position.set(0, 0.05, 1.1);
  g.add(nose);
  for (const x of [-0.25, 0.25]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 8), pink);
    ear.rotation.x = Math.PI / 2;
    ear.position.set(x, 0.4, 0.45);
    g.add(ear);
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 4, 10, Math.PI * 1.3), pink);
  tail.position.set(0, 0.1, -0.85);
  tail.rotation.y = Math.PI / 2;
  g.add(tail);
  // Wind-up key on its back.
  const key = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 4, 8), mat(0xe8c14a));
  key.position.set(0, 0.6, -0.2);
  g.add(key);
  g.children.forEach((c) => (c.castShadow = true));
  return g;
}

function puddleMesh(): THREE.Group {
  const g = new THREE.Group();
  const milk = new THREE.MeshStandardMaterial({ color: 0xfdfcf6, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.92 });
  const main = new THREE.Mesh(new THREE.CylinderGeometry(MILK_RADIUS, MILK_RADIUS, 0.06, 18), milk);
  main.scale.set(1, 1, 0.85);
  g.add(main);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.random();
    const blob = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.06, 10), milk);
    blob.position.set(Math.cos(a) * MILK_RADIUS * 0.95, 0, Math.sin(a) * MILK_RADIUS * 0.8);
    g.add(blob);
  }
  // Tipped-over milk carton.
  const carton = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 1.1), mat(0x7fc8ff));
  carton.position.set(MILK_RADIUS * 0.6, 0.35, 0);
  carton.rotation.set(0, 0.6, Math.PI / 2);
  carton.castShadow = true;
  g.add(carton);
  return g;
}

export class ItemSystem {
  readonly group = new THREE.Group();
  private boxes: Box[] = [];
  private yarns: Yarn[] = [];
  private bananas: Banana[] = [];
  private mice: Mouse[] = [];
  private puddles: Puddle[] = [];
  private time = 0;

  constructor(private track: Track) {
    const geo = new THREE.BoxGeometry(1.8, 1.8, 1.8);
    const tex = boxTexture();
    // Self-lit so the boxes pop from a distance and in shadow.
    const boxMat = mat(0xffffff, { map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, transparent: true, opacity: 0.92 });
    for (const t of track.def.boxRows) {
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
    return [...this.bananas, ...this.puddles].map((b) => b.pos);
  }

  clear(): void {
    for (const y of this.yarns) this.group.remove(y.mesh);
    for (const b of this.bananas) this.group.remove(b.mesh);
    for (const m of this.mice) this.group.remove(m.mesh);
    for (const p of this.puddles) this.group.remove(p.mesh);
    this.yarns = [];
    this.bananas = [];
    this.mice = [];
    this.puddles = [];
    for (const b of this.boxes) {
      b.respawn = 0;
      b.mesh.visible = true;
    }
  }

  /** Hits `victim`, reporting a shield block if a 📦 absorbed it. */
  private strike(victim: Racer, by: Racer, item: HitItem, events: ItemEvent[]): void {
    const k = victim.physics;
    const shielded = k.shieldTime > 0 && k.invulnTime <= 0 && k.starTime <= 0;
    if (k.hit()) events.push({ type: 'hit', victim, by, item });
    else if (shielded) events.push({ type: 'blocked', racer: victim });
  }

  /** Fire the held item. Returns what happened (a 💦 bath can hit several racers at once). */
  use(r: Racer & ItemHolder, standings: Racer[]): ItemEvent[] {
    const item = r.item;
    if (!item || r.roulette > 0) return [];
    r.itemHold = 0;
    if (item === 'fish3' && r.itemUses > 1) r.itemUses--;
    else {
      r.item = null;
      r.itemUses = 0;
    }
    const events: ItemEvent[] = [{ type: 'used', racer: r, item }];
    const k = r.physics;
    const f = k.forward;
    if (item === 'fish' || item === 'fish3') {
      k.fishBoost();
    } else if (item === 'box') {
      k.shield();
    } else if (item === 'catnip') {
      k.catnip();
    } else if (item === 'bath') {
      // Everyone ahead of you gets a surprise bath.
      for (const v of standings.slice(0, standings.indexOf(r))) this.strike(v, r, 'bath', events);
    } else if (item === 'mouse') {
      const pos = k.pos.clone().addScaledVector(f, 2.5);
      const mesh = mouseMesh();
      mesh.position.copy(pos);
      this.group.add(mesh);
      const idx = this.track.nearest(pos.x, pos.z).index;
      const t = this.track.tangents[idx];
      const lane = (pos.x - this.track.points[idx].x) * t.z - (pos.z - this.track.points[idx].z) * t.x;
      this.mice.push({ mesh, pos, vel: f.clone().multiplyScalar(MOUSE_SPEED), idx, lane, owner: r, age: 0 });
    } else if (item === 'milk') {
      const pos = k.pos.clone().addScaledVector(f, -(MILK_RADIUS + 2));
      pos.y = this.track.heightAt(pos.x, pos.z) + 0.04;
      const mesh = puddleMesh();
      mesh.position.copy(pos);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(mesh);
      this.puddles.push({ mesh, pos, owner: r, age: 0 });
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
    return events;
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
          r.itemUses = r.item === 'fish3' ? 3 : 1;
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
          this.strike(r, y.owner, 'yarn', events);
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
          this.strike(r, b.owner, 'banana', events);
          this.removeBanana(b);
          break;
        }
      }
    }

    // --- Wind-up mice: run straight, bounce off walls and scenery ---
    for (const m of [...this.mice]) {
      m.age += dt;
      // Runs along the road in its own lane (no homing): turn towards a point a little ahead.
      m.idx = this.track.nearestAround(m.pos.x, m.pos.z, m.idx, 10).index;
      const ai = (m.idx + 5) % SAMPLES;
      const ap = this.track.points[ai];
      const at = this.track.tangents[ai];
      const want = Math.atan2(ap.x + at.z * m.lane - m.pos.x, ap.z - at.x * m.lane - m.pos.z);
      const cur = Math.atan2(m.vel.x, m.vel.z);
      const turn = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      const heading = cur + Math.max(-3 * dt, Math.min(3 * dt, turn));
      m.vel.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(MOUSE_SPEED);
      m.pos.addScaledVector(m.vel, dt);
      this.track.collide(m.pos, m.vel, 0.6); // bounces off walls, trees, logs…
      m.vel.y = 0;
      m.vel.setLength(MOUSE_SPEED); // …without slowing down
      m.pos.y = this.track.heightAt(m.pos.x, m.pos.z) + 0.45;
      m.mesh.position.copy(m.pos);
      m.mesh.rotation.y = Math.atan2(m.vel.x, m.vel.z);
      m.mesh.position.y += Math.abs(Math.sin(this.time * 30)) * 0.12; // scurrying
      let gone = m.age > MOUSE_LIFE;
      for (const r of racers) {
        if (gone) break;
        if (r === m.owner && m.age < 0.6) continue;
        if (r.physics.pos.distanceToSquared(m.pos) < KART_HIT_RADIUS ** 2) {
          this.strike(r, m.owner, 'mouse', events);
          gone = true;
        }
      }
      for (const b of [...this.bananas]) {
        if (gone) break;
        if (b.pos.distanceToSquared(m.pos) < 1.5 ** 2) {
          this.removeBanana(b);
          gone = true;
        }
      }
      if (gone) {
        this.group.remove(m.mesh);
        this.mice.splice(this.mice.indexOf(m), 1);
      }
    }

    // --- Milk puddles: everyone who drives through slips (the puddle stays) ---
    for (const p of [...this.puddles]) {
      p.age += dt;
      if (p.age > MILK_LIFE) {
        this.group.remove(p.mesh);
        this.puddles.splice(this.puddles.indexOf(p), 1);
        continue;
      }
      p.mesh.scale.setScalar(Math.min(1, p.age * 4)); // spreads out when poured
      for (const r of racers) {
        if (r === p.owner && p.age < 2) continue;
        const d2 = (r.physics.pos.x - p.pos.x) ** 2 + (r.physics.pos.z - p.pos.z) ** 2;
        if (d2 < (MILK_RADIUS + 0.6) ** 2 && r.physics.grounded && r.physics.slip())
          events.push({ type: 'hit', victim: r, by: p.owner, item: 'milk' });
      }
    }

    // --- Catnip: an invincible kart bowls over whoever it touches ---
    for (const r of racers) {
      if (r.physics.starTime <= 0) continue;
      for (const o of racers) {
        if (o === r || o.physics.pos.distanceToSquared(r.physics.pos) > 2.6 ** 2) continue;
        this.strike(o, r, 'catnip', events);
      }
    }
    return events;
  }

  /** Decides whether an AI racer should fire its item now. */
  aiWantsToUse(r: Racer & ItemHolder, standings: Racer[]): boolean {
    if (!r.item || r.roulette > 0 || r.physics.spinTime > 0) return false;
    const place = standings.indexOf(r);
    const myDist = r.tracker.distance;
    if (r.item === 'fish' || r.item === 'fish3') return r.itemHold > 0.6 && !r.physics.offroad;
    if (r.item === 'box') return r.itemHold > 0.8 && r.physics.shieldTime <= 0;
    if (r.item === 'catnip') return r.itemHold > 0.5;
    if (r.item === 'bath') return r.itemHold > 0.5 && place > 0;
    if (r.item === 'yarn' || r.item === 'mouse') {
      const ahead = place > 0 ? standings[place - 1] : null;
      const gap = ahead ? ahead.tracker.distance - myDist : Infinity;
      const range = r.item === 'mouse' ? 18 : 30; // the mouse can't turn, so wait until close
      return (gap > 2 && gap < range && r.itemHold > 0.5) || r.itemHold > 6;
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
