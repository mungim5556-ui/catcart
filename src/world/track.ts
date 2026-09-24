import * as THREE from 'three';
import type { KartWorld } from '../kart/kartPhysics';

export const ROAD_WIDTH = 16;
export const SAMPLES = 400;

interface Rect {
  // oriented rectangle on the ground: center, forward axis, half sizes
  cx: number;
  cz: number;
  fx: number;
  fz: number;
  halfLen: number;
  halfWidth: number;
}

interface Ramp extends Rect {
  height: number;
}

interface Circle {
  x: number;
  z: number;
  r: number;
}

function toLocal(rect: Rect, x: number, z: number): { u: number; v: number } | null {
  const dx = x - rect.cx;
  const dz = z - rect.cz;
  const u = dx * rect.fx + dz * rect.fz; // along forward
  const v = dx * rect.fz - dz * rect.fx; // sideways
  if (Math.abs(u) > rect.halfLen || Math.abs(v) > rect.halfWidth) return null;
  return { u, v };
}

/** Deterministic RNG so the scenery is the same every load. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });

/**
 * Test course: a closed spline road on a grassy field with boost pads,
 * a jump ramp, trees and yarn balls. Implements the physics world queries.
 */
export class Track implements KartWorld {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  readonly bounds = 170;
  /** Evenly spaced centre-line samples (index 0 = start/finish line). */
  readonly points: THREE.Vector3[];
  readonly tangents: THREE.Vector3[];
  private pads: Rect[] = [];
  private ramps: Ramp[] = [];
  private obstacles: Circle[] = [];

  constructor() {
    this.curve = new THREE.CatmullRomCurve3(
      [
        [0, -90],
        [70, -100],
        [120, -60],
        [110, 0],
        [60, 20],
        [40, 70],
        [72, 98],
        [68, 132],
        [20, 142],
        [-50, 120],
        [-80, 70],
        [-52, 40],
        [-62, 8],
        [-100, 0],
        [-120, -60],
        [-70, -100],
      ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.points = this.curve.getSpacedPoints(SAMPLES).slice(0, SAMPLES);
    this.tangents = this.points.map((_, i) => this.curve.getTangentAt(i / SAMPLES).setY(0).normalize());

    this.buildGround();
    this.buildRoad();
    this.buildStartLine();
    // Boost pads and ramps sit on straights so the boost never shoots you into a hairpin.
    for (const t of [0.02, 0.18, 0.48, 0.88]) this.addBoostPad(t);
    this.addRamp(0.1, 1.4);
    this.addRamp(0.53, 1.8);
    this.buildScenery();
    this.buildFence();
  }

  // ---------- KartWorld ----------

  heightAt(x: number, z: number): number {
    let h = 0;
    for (const ramp of this.ramps) {
      const l = toLocal(ramp, x, z);
      if (l) h = Math.max(h, ((l.u + ramp.halfLen) / (2 * ramp.halfLen)) * ramp.height);
    }
    return h;
  }

  isOffroad(x: number, z: number): boolean {
    return this.nearest(x, z).dist > ROAD_WIDTH / 2 + 0.8;
  }

  isBoostPad(x: number, z: number): boolean {
    return this.pads.some((p) => toLocal(p, x, z) !== null);
  }

  collide(pos: THREE.Vector3, vel: THREE.Vector3, radius: number): boolean {
    let hit = false;
    for (const o of this.obstacles) {
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const min = o.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        pos.x = o.x + nx * min;
        pos.z = o.z + nz * min;
        hit = this.bounce(vel, nx, nz) || hit;
      }
    }
    const b = this.bounds - radius;
    if (pos.x > b) { pos.x = b; hit = this.bounce(vel, -1, 0) || hit; }
    if (pos.x < -b) { pos.x = -b; hit = this.bounce(vel, 1, 0) || hit; }
    if (pos.z > b) { pos.z = b; hit = this.bounce(vel, 0, -1) || hit; }
    if (pos.z < -b) { pos.z = -b; hit = this.bounce(vel, 0, 1) || hit; }
    return hit;
  }

  respawnPoint(x: number, z: number): { pos: THREE.Vector3; yaw: number } {
    const { index } = this.nearest(x, z);
    return this.pose(index);
  }

  /** Start grid position (slot 0 = pole). Two columns, staggered, behind the line. */
  gridPose(slot: number): { pos: THREE.Vector3; yaw: number } {
    const row = Math.floor(slot / 2);
    const col = slot % 2;
    const p = this.pose(SAMPLES - 3 - row * 4 - col * 2);
    const t = this.tangents[SAMPLES - 3 - row * 4 - col * 2];
    const side = col === 0 ? 3.5 : -3.5;
    p.pos.x += t.z * side;
    p.pos.z -= t.x * side;
    return p;
  }

  startPose(): { pos: THREE.Vector3; yaw: number } {
    return this.gridPose(0);
  }

  // ---------- helpers ----------

  private pose(index: number): { pos: THREE.Vector3; yaw: number } {
    const p = this.points[index].clone();
    const t = this.tangents[index];
    return { pos: p, yaw: Math.atan2(t.x, t.z) };
  }

  private bounce(vel: THREE.Vector3, nx: number, nz: number): boolean {
    const vn = vel.x * nx + vel.z * nz;
    if (vn >= 0) return false;
    vel.x -= 1.5 * vn * nx;
    vel.z -= 1.5 * vn * nz;
    vel.x *= 0.7;
    vel.z *= 0.7;
    return vn < -2;
  }

  /** Like nearest(), but only searches `range` samples either side of `hint`. */
  nearestAround(x: number, z: number, hint: number, range: number): { index: number; dist: number } {
    let best = hint;
    let bestD = Infinity;
    for (let o = -range; o <= range; o++) {
      const i = (hint + o + SAMPLES) % SAMPLES;
      const p = this.points[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, dist: Math.sqrt(bestD) };
  }

  nearest(x: number, z: number): { index: number; dist: number } {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { index: best, dist: Math.sqrt(bestD) };
  }

  private rectAt(t: number, halfLen: number, halfWidth: number, lateral = 0): Rect {
    const i = Math.floor(t * SAMPLES) % SAMPLES;
    const p = this.points[i];
    const f = this.tangents[i];
    return {
      cx: p.x + f.z * lateral,
      cz: p.z - f.x * lateral,
      fx: f.x,
      fz: f.z,
      halfLen,
      halfWidth,
    };
  }

  private placeOnRect(obj: THREE.Object3D, rect: Rect, y: number): void {
    obj.position.set(rect.cx, y, rect.cz);
    obj.rotation.y = Math.atan2(rect.fx, rect.fz);
  }

  // ---------- visuals ----------

  private buildGround(): void {
    const geo = new THREE.PlaneGeometry(900, 900, 60, 60);
    geo.rotateX(-Math.PI / 2);
    // Gentle color variation so the grass does not look flat.
    const colors: number[] = [];
    const rand = rng(7);
    const a = new THREE.Color(0x8fd16a);
    const b = new THREE.Color(0x7cc25c);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const c = a.clone().lerp(b, rand());
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
    );
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private ribbon(offsetA: number, offsetB: number, y: number, colorFn: (i: number) => THREE.Color): THREE.Mesh {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const p = this.points[i % SAMPLES];
      const t = this.tangents[i % SAMPLES];
      const nx = t.z;
      const nz = -t.x;
      pos.push(p.x + nx * offsetA, y, p.z + nz * offsetA, p.x + nx * offsetB, y, p.z + nz * offsetB);
      const c = colorFn(i);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < SAMPLES) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    return m;
  }

  private buildRoad(): void {
    const w = ROAD_WIDTH / 2;
    const asphalt = new THREE.Color(0x6b6f80);
    this.group.add(this.ribbon(-w, w, 0.02, () => asphalt));
    const red = new THREE.Color(0xff5a6e);
    const white = new THREE.Color(0xffffff);
    const curb = (i: number) => (Math.floor(i / 3) % 2 ? red : white);
    this.group.add(this.ribbon(w, w + 1.2, 0.04, curb));
    this.group.add(this.ribbon(-w - 1.2, -w, 0.04, curb));
    // dashed centre line
    const line = new THREE.Color(0xfff3b0);
    const dashes = this.ribbon(-0.2, 0.2, 0.03, (i) => (Math.floor(i / 4) % 2 ? line : asphalt));
    this.group.add(dashes);
  }

  private buildStartLine(): void {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const g = c.getContext('2d')!;
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#222' : '#fff';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 2), new THREE.MeshStandardMaterial({ map: tex }));
    line.geometry.rotateX(-Math.PI / 2);
    const r = this.rectAt(0, 1, ROAD_WIDTH / 2);
    this.placeOnRect(line, r, 0.05); // plane width (local X) lies across the road
    this.group.add(line);

    // Arch over the start line with a paw sign
    const archMat = mat(0xff6f91);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 8, 6), archMat);
      const pr = this.rectAt(0, 1, 1, side * (ROAD_WIDTH / 2 + 2));
      post.position.set(pr.cx, 4, pr.cz);
      post.castShadow = true;
      this.group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 5, 1.6, 0.8), mat(0xffffff));
    this.placeOnRect(beam, r, 8);
    beam.castShadow = true;
    this.group.add(beam);
    const sign = document.createElement('canvas');
    sign.width = 512;
    sign.height = 64;
    const sg = sign.getContext('2d')!;
    sg.fillStyle = '#fff';
    sg.fillRect(0, 0, 512, 64);
    sg.fillStyle = '#ff6f91';
    sg.font = 'bold 44px sans-serif';
    sg.textAlign = 'center';
    sg.fillText('🐾 CATCART 🐾', 256, 48);
    const signTex = new THREE.CanvasTexture(sign);
    signTex.colorSpace = THREE.SRGBColorSpace;
    for (const dir of [1, -1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH + 4, 1.4), new THREE.MeshBasicMaterial({ map: signTex }));
      this.placeOnRect(plate, r, 8);
      plate.rotation.y += dir === 1 ? Math.PI : 0;
      plate.position.x -= r.fx * 0.41 * dir;
      plate.position.z -= r.fz * 0.41 * dir;
      this.group.add(plate);
    }
  }

  private addBoostPad(t: number): void {
    const rect = this.rectAt(t, 3, 2.5);
    this.pads.push(rect);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffb300';
    g.fillRect(0, 0, 64, 128);
    g.fillStyle = '#fff6d0';
    for (let i = 0; i < 3; i++) {
      const y = 20 + i * 36;
      g.beginPath();
      g.moveTo(8, y + 24);
      g.lineTo(32, y);
      g.lineTo(56, y + 24);
      g.lineTo(46, y + 30);
      g.lineTo(32, y + 14);
      g.lineTo(18, y + 30);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(5, 6);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI); // arrows point along +forward
    const pad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
    this.placeOnRect(pad, rect, 0.06);
    this.group.add(pad);
  }

  private addRamp(t: number, height: number): void {
    const ramp: Ramp = { ...this.rectAt(t, 4, 4, 2.5), height };
    this.ramps.push(ramp);
    // wedge: rises along +z (local forward)
    const w = ramp.halfWidth;
    const l = ramp.halfLen;
    const v = [
      [-w, 0, -l], [w, 0, -l], [w, 0, l], [-w, 0, l], // bottom
      [-w, height, l], [w, height, l], // top edge
    ];
    // Explicit non-indexed triangles so flat shading works cleanly.
    const tris: number[][] = [
      [0, 4, 1], [1, 4, 5], // slope
      [3, 2, 5], [3, 5, 4], // back face
      [0, 3, 4], // left side
      [1, 5, 2], // right side
    ];
    const pos: number[] = [];
    for (const tri of tris) for (const i of tri) pos.push(...v[i]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x57c7ff, flatShading: true, side: THREE.DoubleSide }));
    m.castShadow = true;
    m.receiveShadow = true;
    this.placeOnRect(m, ramp, 0);
    this.group.add(m);
  }

  private buildScenery(): void {
    const rand = rng(42);
    const trunkMat = mat(0x9b6b43);
    const leafMats = [mat(0x4fae5a), mat(0x69c16b), mat(0x3f9a55)];
    const rockMat = mat(0xb8b3c7);
    const yarnMats = [mat(0xff8fab), mat(0x9ad0ff), mat(0xc9a4ff), mat(0xffd36e)];

    let placed = 0;
    for (let attempt = 0; attempt < 900 && placed < 170; attempt++) {
      const x = (rand() * 2 - 1) * (this.bounds - 6);
      const z = (rand() * 2 - 1) * (this.bounds - 6);
      if (this.nearest(x, z).dist < ROAD_WIDTH / 2 + 7) continue;
      if (this.obstacles.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < 36)) continue;
      const kind = rand();
      if (kind < 0.62) {
        const s = 0.8 + rand() * 0.8;
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.45 * s, 2 * s, 5), trunkMat);
        trunk.position.y = s;
        const leafMat = leafMats[Math.floor(rand() * leafMats.length)];
        for (let k = 0; k < 2; k++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry((2.2 - k * 0.6) * s, 2.6 * s, 6), leafMat);
          cone.position.y = (2.6 + k * 1.4) * s;
          cone.castShadow = true;
          tree.add(cone);
        }
        trunk.castShadow = true;
        tree.add(trunk);
        tree.position.set(x, 0, z);
        tree.rotation.y = rand() * Math.PI;
        this.group.add(tree);
        this.obstacles.push({ x, z, r: 0.6 * s });
      } else if (kind < 0.82) {
        const s = 0.8 + rand() * 1.4;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
        rock.position.set(x, s * 0.5, z);
        rock.rotation.set(rand(), rand(), rand());
        rock.castShadow = true;
        this.group.add(rock);
        this.obstacles.push({ x, z, r: s * 0.9 });
      } else {
        // Giant yarn ball: sphere wrapped with a few rings
        const s = 1.2 + rand() * 0.8;
        const m = yarnMats[Math.floor(rand() * yarnMats.length)];
        const ball = new THREE.Group();
        ball.add(new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), m));
        for (let k = 0; k < 3; k++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 1.0, 0.08 * s, 4, 12), m);
          ring.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
          ball.add(ring);
        }
        ball.children.forEach((c) => (c.castShadow = true));
        ball.position.set(x, s, z);
        this.group.add(ball);
        this.obstacles.push({ x, z, r: s });
      }
      placed++;
    }
  }

  private buildFence(): void {
    const m = mat(0xfff1dc);
    const len = this.bounds * 2;
    for (const [x, z, ry] of [
      [0, this.bounds, 0],
      [0, -this.bounds, 0],
      [this.bounds, 0, Math.PI / 2],
      [-this.bounds, 0, Math.PI / 2],
    ]) {
      const fence = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.5), m);
      fence.position.set(x, 0.6, z);
      fence.rotation.y = ry;
      fence.castShadow = true;
      this.group.add(fence);
    }
  }
}
