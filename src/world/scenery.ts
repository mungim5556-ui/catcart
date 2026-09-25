import * as THREE from 'three';
import type { PropKind } from './trackDefs';

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });

// Shared materials (props are many; materials are few).
const M = {
  trunk: mat(0x9b6b43),
  palmTrunk: mat(0xb08457),
  leaves: [mat(0x4fae5a), mat(0x69c16b), mat(0x3f9a55)],
  palmLeaf: mat(0x46b35a),
  snow: mat(0xffffff),
  rock: mat(0xb8b3c7),
  ice: mat(0xa8d8f0, { roughness: 0.3, transparent: true, opacity: 0.9 }),
  yarn: [mat(0xff8fab), mat(0x9ad0ff), mat(0xc9a4ff), mat(0xffd36e)],
  umbrella: [mat(0xff6f91), mat(0xffb300), mat(0x4fc3ff), mat(0x52c77a)],
  pole: mat(0xeeeeee),
  sand: mat(0xe9cf8a),
  sandDark: mat(0xd9b96c),
  carrot: mat(0xff8a3d),
  coal: mat(0x2d2d3a),
  scarf: [mat(0xff5a6e), mat(0x7a5cff), mat(0x52c77a)],
  gift: [mat(0xff6f91), mat(0x4fc3ff), mat(0xffb300)],
  ribbon: mat(0xffffff),
  // city
  bulb: new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
  lampPole: mat(0x3a3a48),
  lightCone: new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }),
  bin: mat(0x5c6b73),
  wood: mat(0xa9804f),
  cardboard: mat(0xc9a06a),
  // forest
  canopy: [mat(0x4c9a3f), mat(0x6bb04c), mat(0x3d8a45), mat(0x8fbf4a)],
  capRed: mat(0xe0473c),
  capBrown: mat(0xb07a45),
  stem: mat(0xf2e6cf),
  dot: mat(0xffffff),
  cut: mat(0xe0c48f),
  // desert
  cactus: mat(0x5f9e4a),
  sandstone: mat(0xd9b27a),
  weed: new THREE.MeshStandardMaterial({ color: 0x9b7a4a, wireframe: true }),
  clay: mat(0xc0703f),
  gold: mat(0xe8c14a, { metalness: 0.4, roughness: 0.4 }),
};

/** Window-grid facade texture; lit windows glow via the emissive map. */
const FACADES = [0x3d3a52, 0x4a3b45, 0x2f4450, 0x514336].map((wall) => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#' + wall.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 124; y += 16)
    for (let x = 6; x < 60; x += 14) {
      const lit = Math.random() < 0.45;
      g.fillStyle = lit ? (Math.random() < 0.7 ? '#ffd98a' : '#9fe0ff') : '#1c1a28';
      g.fillRect(x, y, 8, 9);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
});

const FACADE_MATS = FACADES.map(
  (tex) => new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.9 }),
);

const NEON_TEXT = ['🐟 참치', '냥냥 BAR', '고등어 24시', '🐾 츄르', 'CAT CAFE', '🥛 우유'];
const NEON_COLORS = ['#ff4fa3', '#4fe3ff', '#ffe14f', '#9dff6b', '#c98bff'];

function neonTexture(r: () => number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#15121f';
  g.fillRect(0, 0, 256, 96);
  const col = NEON_COLORS[Math.floor(r() * NEON_COLORS.length)];
  g.strokeStyle = col;
  g.lineWidth = 5;
  g.shadowColor = col;
  g.shadowBlur = 14;
  g.strokeRect(8, 8, 240, 80);
  g.fillStyle = col;
  g.font = 'bold 40px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(NEON_TEXT[Math.floor(r() * NEON_TEXT.length)], 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const pick = <T>(arr: T[], r: () => number) => arr[Math.floor(r() * arr.length)];

function m(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** Rotates a mesh about one axis and returns it (Group.add returns the parent, not the child). */
function rot(mesh: THREE.Mesh, axis: 'x' | 'y' | 'z', angle: number): THREE.Mesh {
  mesh.rotation[axis] = angle;
  return mesh;
}

/** Builds one scenery prop. Returns the object and its collision radius. */
export function buildProp(kind: PropKind, r: () => number): { obj: THREE.Object3D; radius: number } {
  const g = new THREE.Group();
  switch (kind) {
    case 'pine':
    case 'snowPine': {
      const s = 0.8 + r() * 0.8;
      g.add(m(new THREE.CylinderGeometry(0.35 * s, 0.45 * s, 2 * s, 5), M.trunk, 0, s, 0));
      const leaf = pick(M.leaves, r);
      for (let k = 0; k < 2; k++) {
        g.add(m(new THREE.ConeGeometry((2.2 - k * 0.6) * s, 2.6 * s, 6), leaf, 0, (2.6 + k * 1.4) * s, 0));
        if (kind === 'snowPine') g.add(m(new THREE.ConeGeometry((1.2 - k * 0.35) * s, 1.3 * s, 6), M.snow, 0, (3.35 + k * 1.4) * s, 0));
      }
      g.rotation.y = r() * Math.PI;
      return { obj: g, radius: 0.6 * s };
    }
    case 'rock':
    case 'iceRock': {
      const s = 0.8 + r() * 1.4;
      const rock = m(new THREE.DodecahedronGeometry(s, 0), kind === 'rock' ? M.rock : M.ice, 0, s * 0.5, 0);
      rock.rotation.set(r(), r(), r());
      g.add(rock);
      return { obj: g, radius: s * 0.9 };
    }
    case 'yarn': {
      const s = 1.2 + r() * 0.8;
      const mm = pick(M.yarn, r);
      g.add(m(new THREE.IcosahedronGeometry(s, 1), mm, 0, s, 0));
      for (let k = 0; k < 3; k++) {
        const ring = m(new THREE.TorusGeometry(s, 0.08 * s, 4, 12), mm, 0, s, 0);
        ring.rotation.set(r() * Math.PI, r() * Math.PI, 0);
        g.add(ring);
      }
      return { obj: g, radius: s };
    }
    case 'palm': {
      const s = 0.9 + r() * 0.6;
      // Curved trunk: stacked, slightly offset segments.
      const lean = (r() - 0.5) * 0.5;
      let top = new THREE.Vector3();
      for (let k = 0; k < 6; k++) {
        const seg = m(new THREE.CylinderGeometry(0.28 * s, 0.34 * s, 1.1 * s, 6), M.palmTrunk, lean * k * k * 0.12 * s, (0.55 + k * 1.0) * s, 0);
        seg.rotation.z = -lean * k * 0.15;
        g.add(seg);
        top = seg.position.clone();
      }
      for (let k = 0; k < 6; k++) {
        const frond = m(new THREE.ConeGeometry(0.5 * s, 3.2 * s, 4), M.palmLeaf, top.x, top.y + 0.5 * s, top.z);
        frond.rotation.set(0, (k / 6) * Math.PI * 2, 0);
        frond.rotateZ(Math.PI / 2 + 0.45);
        frond.translateY(1.4 * s);
        frond.scale.set(1, 1, 0.25);
        g.add(frond);
      }
      g.rotation.y = r() * Math.PI * 2;
      return { obj: g, radius: 0.5 * s };
    }
    case 'umbrella': {
      g.add(m(new THREE.CylinderGeometry(0.06, 0.06, 3, 5), M.pole, 0, 1.5, 0));
      const top = m(new THREE.ConeGeometry(1.8, 0.8, 8), pick(M.umbrella, r), 0, 3, 0);
      g.add(top);
      g.rotation.z = (r() - 0.5) * 0.3;
      return { obj: g, radius: 0.4 };
    }
    case 'beachBall': {
      const s = 0.9 + r() * 0.5;
      g.add(m(new THREE.IcosahedronGeometry(s, 1), pick(M.umbrella, r), 0, s, 0));
      const band = m(new THREE.TorusGeometry(s * 0.98, 0.18 * s, 4, 12), M.pole, 0, s, 0);
      band.rotation.x = r() * Math.PI;
      g.add(band);
      return { obj: g, radius: s };
    }
    case 'sandcastle': {
      const s = 0.8 + r() * 0.5;
      g.add(m(new THREE.BoxGeometry(3 * s, 1.2 * s, 3 * s), M.sand, 0, 0.6 * s, 0));
      for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
        g.add(m(new THREE.CylinderGeometry(0.5 * s, 0.6 * s, 2 * s, 6), M.sandDark, x * s, 1 * s, z * s));
        g.add(m(new THREE.ConeGeometry(0.6 * s, 0.8 * s, 6), M.sand, x * s, 2.4 * s, z * s));
      }
      g.rotation.y = r() * Math.PI;
      return { obj: g, radius: 2.1 * s };
    }
    case 'snowman': {
      const s = 0.8 + r() * 0.4;
      g.add(m(new THREE.IcosahedronGeometry(1.1 * s, 1), M.snow, 0, 1 * s, 0));
      g.add(m(new THREE.IcosahedronGeometry(0.8 * s, 1), M.snow, 0, 2.5 * s, 0));
      g.add(m(new THREE.IcosahedronGeometry(0.55 * s, 1), M.snow, 0, 3.6 * s, 0));
      const nose = m(new THREE.ConeGeometry(0.1 * s, 0.5 * s, 5), M.carrot, 0, 3.6 * s, 0.7 * s);
      nose.rotation.x = Math.PI / 2;
      g.add(nose);
      for (const x of [-0.18, 0.18]) g.add(m(new THREE.BoxGeometry(0.1 * s, 0.1 * s, 0.05), M.coal, x * s, 3.78 * s, 0.5 * s));
      const scarf = m(new THREE.TorusGeometry(0.6 * s, 0.12 * s, 4, 10), pick(M.scarf, r), 0, 3.1 * s, 0);
      scarf.rotation.x = Math.PI / 2;
      g.add(scarf);
      // Cat ears on the snowman, of course.
      for (const x of [-0.3, 0.3]) g.add(m(new THREE.ConeGeometry(0.16 * s, 0.35 * s, 4), M.snow, x * s, 4.1 * s, 0));
      g.rotation.y = r() * Math.PI * 2;
      return { obj: g, radius: 1.1 * s };
    }
    case 'present': {
      const s = 0.8 + r() * 0.8;
      g.add(m(new THREE.BoxGeometry(1.6 * s, 1.4 * s, 1.6 * s), pick(M.gift, r), 0, 0.7 * s, 0));
      g.add(m(new THREE.BoxGeometry(1.65 * s, 1.45 * s, 0.25 * s), M.ribbon, 0, 0.7 * s, 0));
      g.add(m(new THREE.BoxGeometry(0.25 * s, 1.45 * s, 1.65 * s), M.ribbon, 0, 0.7 * s, 0));
      g.rotation.y = r() * Math.PI;
      return { obj: g, radius: 1.1 * s };
    }
    // ---------- city ----------
    case 'building': {
      const w = 8 + r() * 5;
      const d = 8 + r() * 3;
      const h = 10 + r() * 16;
      // Shared facade material; window tiling is baked into the UVs so buildings can be merged.
      const facade = FACADE_MATS[Math.floor(r() * FACADE_MATS.length)];
      const box = new THREE.BoxGeometry(w, h, d);
      const uv = box.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.round(w / 5), uv.getY(i) * Math.round(h / 8));
      g.add(m(box, facade, 0, h / 2, 0));
      g.add(m(new THREE.BoxGeometry(w + 0.6, 0.6, d + 0.6), M.lampPole, 0, h + 0.3, 0)); // roof ledge
      if (r() < 0.6) g.add(m(new THREE.BoxGeometry(2, 1.4, 2), M.bin, (r() - 0.5) * w * 0.5, h + 1.3, (r() - 0.5) * d * 0.5)); // AC unit
      return { obj: g, radius: Math.min(w, d) / 2 + 0.5 };
    }
    case 'lamp': {
      g.add(m(new THREE.CylinderGeometry(0.12, 0.16, 6.5, 6), M.lampPole, 0, 3.25, 0));
      g.add(m(new THREE.BoxGeometry(0.15, 0.15, 1.6), M.lampPole, 0, 6.4, 0.7));
      const bulb = m(new THREE.BoxGeometry(0.6, 0.25, 0.6), M.bulb, 0, 6.25, 1.4);
      bulb.castShadow = false;
      g.add(bulb);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 6.2, 16, 1, true), M.lightCone);
      cone.position.set(0, 3.1, 1.4);
      g.add(cone);
      return { obj: g, radius: 0.3 };
    }
    case 'neon': {
      g.add(m(new THREE.CylinderGeometry(0.1, 0.1, 5, 5), M.lampPole, 0, 2.5, 0));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: neonTexture(r), side: THREE.DoubleSide }));
      sign.position.set(0, 5.2, 0);
      g.add(sign);
      return { obj: g, radius: 0.3 };
    }
    case 'trashcan': {
      g.add(m(new THREE.CylinderGeometry(0.55, 0.45, 1.3, 8), M.bin, 0, 0.65, 0));
      g.add(m(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 8), M.lampPole, 0, 1.36, 0));
      return { obj: g, radius: 0.7 };
    }
    case 'crate': {
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const box = m(new THREE.BoxGeometry(1.4, 1.1, 1.4), k % 2 ? M.cardboard : M.wood, (r() - 0.5) * 0.4, 0.55 + k * 1.1, (r() - 0.5) * 0.4);
        box.rotation.y = r();
        g.add(box);
      }
      return { obj: g, radius: 1 };
    }
    // ---------- forest ----------
    case 'broadleaf': {
      const s = 0.9 + r() * 0.7;
      g.add(m(new THREE.CylinderGeometry(0.35 * s, 0.5 * s, 3.2 * s, 6), M.trunk, 0, 1.6 * s, 0));
      const leaf = pick(M.canopy, r);
      for (let k = 0; k < 4; k++) {
        g.add(m(new THREE.IcosahedronGeometry((1.4 + r() * 0.8) * s, 0), leaf, (r() - 0.5) * 2.2 * s, (3.6 + r() * 1.6) * s, (r() - 0.5) * 2.2 * s));
      }
      return { obj: g, radius: 0.6 * s };
    }
    case 'mushroom': {
      const s = 0.8 + r() * 1.2;
      g.add(m(new THREE.CylinderGeometry(0.35 * s, 0.45 * s, 1.4 * s, 7), M.stem, 0, 0.7 * s, 0));
      const red = r() < 0.65;
      const cap = m(new THREE.SphereGeometry(1.2 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), red ? M.capRed : M.capBrown, 0, 1.3 * s, 0);
      g.add(cap);
      if (red)
        for (let k = 0; k < 5; k++) {
          const a = r() * Math.PI * 2;
          const e = 0.3 + r() * 0.8;
          g.add(m(new THREE.IcosahedronGeometry(0.16 * s, 0), M.dot, Math.cos(a) * Math.sin(e) * 1.15 * s, 1.3 * s + Math.cos(e) * 1.15 * s, Math.sin(a) * Math.sin(e) * 1.15 * s));
        }
      return { obj: g, radius: 0.8 * s };
    }
    case 'stump': {
      const s = 0.8 + r() * 0.6;
      g.add(m(new THREE.CylinderGeometry(0.9 * s, 1.1 * s, 1.2 * s, 8), M.trunk, 0, 0.6 * s, 0));
      g.add(m(new THREE.CylinderGeometry(0.85 * s, 0.85 * s, 0.05, 8), M.cut, 0, 1.23 * s, 0));
      return { obj: g, radius: 1.1 * s };
    }
    case 'bush': {
      const s = 0.8 + r() * 0.6;
      const leaf = pick(M.canopy, r);
      for (let k = 0; k < 3; k++) g.add(m(new THREE.IcosahedronGeometry((0.8 + r() * 0.5) * s, 0), leaf, (r() - 0.5) * 1.6 * s, 0.6 * s, (r() - 0.5) * 1.6 * s));
      return { obj: g, radius: 1.1 * s };
    }
    // ---------- desert ----------
    case 'cactus': {
      const s = 0.8 + r() * 0.8;
      g.add(m(new THREE.CylinderGeometry(0.45 * s, 0.5 * s, 4.5 * s, 7), M.cactus, 0, 2.25 * s, 0));
      g.add(m(new THREE.SphereGeometry(0.45 * s, 7, 4), M.cactus, 0, 4.5 * s, 0));
      for (const side of [-1, 1]) {
        if (r() < 0.25) continue;
        const h = (1.6 + r() * 1.4) * s;
        g.add(rot(m(new THREE.CylinderGeometry(0.28 * s, 0.28 * s, 1.1 * s, 6), M.cactus, side * 0.8 * s, h, 0), 'z', Math.PI / 2));
        g.add(m(new THREE.CylinderGeometry(0.28 * s, 0.3 * s, 1.6 * s, 6), M.cactus, side * 1.3 * s, h + 0.7 * s, 0));
      }
      g.rotation.y = r() * Math.PI;
      return { obj: g, radius: 0.7 * s };
    }
    case 'sandRock': {
      const s = 0.8 + r() * 1.8;
      const rock = m(new THREE.DodecahedronGeometry(s, 0), M.sandstone, 0, s * 0.45, 0);
      rock.scale.set(1.3, 0.8, 1);
      rock.rotation.y = r() * Math.PI;
      g.add(rock);
      return { obj: g, radius: s * 1.1 };
    }
    case 'tumbleweed': {
      const s = 0.7 + r() * 0.5;
      g.add(m(new THREE.IcosahedronGeometry(s, 1), M.weed, 0, s, 0));
      return { obj: g, radius: s * 0.8 };
    }
    case 'obelisk': {
      const s = 0.9 + r() * 0.5;
      g.add(rot(m(new THREE.CylinderGeometry(0.7 * s, 1.1 * s, 9 * s, 4), M.sandstone, 0, 4.5 * s, 0), 'y', Math.PI / 4));
      g.add(rot(m(new THREE.ConeGeometry(0.75 * s, 1.2 * s, 4), M.gold, 0, 9.6 * s, 0), 'y', Math.PI / 4));
      return { obj: g, radius: 1.2 * s };
    }
    case 'urn': {
      const s = 0.7 + r() * 0.5;
      g.add(m(new THREE.SphereGeometry(0.8 * s, 8, 6), M.clay, 0, 0.8 * s, 0));
      g.add(m(new THREE.CylinderGeometry(0.35 * s, 0.45 * s, 0.6 * s, 8), M.clay, 0, 1.7 * s, 0));
      return { obj: g, radius: 0.8 * s };
    }
  }
}

/** Pyramids and the cat sphinx. Returns the object and a collision radius. */
export function buildLandmark(kind: 'pyramid' | 'sphinx', size: number): { obj: THREE.Object3D; radius: number } {
  const g = new THREE.Group();
  if (kind === 'pyramid') {
    const half = size / 2;
    const body = m(new THREE.ConeGeometry(half * Math.SQRT2, size * 0.8, 4), M.sandstone, 0, size * 0.4, 0);
    body.rotation.y = Math.PI / 4;
    g.add(body);
    const cap = m(new THREE.ConeGeometry(half * Math.SQRT2 * 0.08, size * 0.064, 4), M.gold, 0, size * 0.8 - size * 0.03, 0);
    cap.rotation.y = Math.PI / 4;
    g.add(cap);
    return { obj: g, radius: half * 1.1 };
  }
  // Cat sphinx lying on a plinth, wearing a striped headdress. Built facing +Z.
  const k = size;
  const stone = M.sandstone;
  const blue = mat(0x3a5fa8);
  g.add(m(new THREE.BoxGeometry(18 * k, 2 * k, 34 * k), mat(0xc9a066), 0, 1 * k, 0)); // plinth
  g.add(m(new THREE.BoxGeometry(11 * k, 8 * k, 22 * k), stone, 0, 6 * k, -4 * k)); // body
  for (const x of [-3.5, 3.5]) g.add(m(new THREE.BoxGeometry(3 * k, 2.6 * k, 12 * k), stone, x * k, 3.3 * k, 11 * k)); // paws
  g.add(m(new THREE.BoxGeometry(8 * k, 7 * k, 6 * k), stone, 0, 14 * k, 6 * k)); // head
  // Headdress: blue/gold striped flaps down the sides.
  for (const x of [-4.6, 4.6])
    for (let i = 0; i < 4; i++) g.add(m(new THREE.BoxGeometry(1.2 * k, 2 * k, 5 * k), i % 2 ? M.gold : blue, x * k, (15.5 - i * 2) * k, 5.5 * k));
  g.add(m(new THREE.BoxGeometry(8.6 * k, 1.2 * k, 6.4 * k), M.gold, 0, 17.8 * k, 6 * k));
  // Cat ears poking through the headdress, face.
  for (const x of [-2.6, 2.6]) {
    const ear = m(new THREE.ConeGeometry(1.6 * k, 3.4 * k, 4), stone, x * k, 19.6 * k, 6 * k);
    ear.rotation.y = Math.PI / 4;
    g.add(ear);
  }
  for (const x of [-1.8, 1.8]) g.add(m(new THREE.BoxGeometry(1.4 * k, 1.6 * k, 0.3 * k), mat(0x2d2d3a), x * k, 15 * k, 9.1 * k)); // eyes
  g.add(rot(m(new THREE.ConeGeometry(0.6 * k, 0.8 * k, 3), mat(0xb07a60), 0, 13 * k, 9.2 * k), 'x', Math.PI));
  for (const side of [-1, 1])
    for (const dy of [0, -0.8]) {
      const w = m(new THREE.BoxGeometry(4 * k, 0.15 * k, 0.15 * k), mat(0x6b5a45), side * 3 * k, (12.6 + dy) * k, 9.2 * k);
      w.rotation.z = side * (0.15 + dy * 0.2);
      g.add(w);
    }
  // Tail curling round the side.
  const tail = m(new THREE.TorusGeometry(4 * k, 0.9 * k, 5, 10, Math.PI), stone, 6 * k, 2.2 * k, -12 * k);
  tail.rotation.x = -Math.PI / 2;
  g.add(tail);
  return { obj: g, radius: 17 * k };
}

/** A broken, hollow fallen tree the road runs through. Axis along local +Z. */
export function buildLogTunnel(radius: number, halfLength: number): THREE.Object3D {
  const g = new THREE.Group();
  const len = halfLength * 2;
  const bark = mat(0x6e4a2f, { side: THREE.FrontSide });
  const inner = mat(0xc99a62, { side: THREE.BackSide });
  const outer = m(new THREE.CylinderGeometry(radius, radius, len, 14, 1, true), bark);
  outer.rotation.x = Math.PI / 2;
  g.add(outer);
  const hollow = m(new THREE.CylinderGeometry(radius - 0.7, radius - 0.7, len, 14, 1, true), inner);
  hollow.rotation.x = Math.PI / 2;
  hollow.receiveShadow = true;
  g.add(hollow);
  // Rims and jagged broken splinters at both ends.
  for (const end of [-1, 1]) {
    const rim = m(new THREE.RingGeometry(radius - 0.7, radius, 14), mat(0xe0c48f, { side: THREE.DoubleSide }), 0, 0, end * halfLength);
    g.add(rim);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const h = 1 + ((i * 7) % 5) * 0.7;
      const spike = m(new THREE.ConeGeometry(0.9, h, 4), bark, Math.cos(a) * (radius - 0.35), Math.sin(a) * (radius - 0.35), end * (halfLength + h / 2 - 0.2));
      spike.rotation.x = end * Math.PI / 2;
      g.add(spike);
    }
  }
  // Mossy top with a couple of mushrooms and a broken branch.
  const moss = m(new THREE.SphereGeometry(radius * 0.55, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5f8f3e), 0, radius - 1.2, -halfLength * 0.3);
  moss.scale.set(1, 0.35, 2.2);
  g.add(moss);
  for (const z of [-4, 3]) {
    g.add(m(new THREE.CylinderGeometry(0.3, 0.35, 1, 6), M.stem, 1.5, radius + 0.3, z));
    g.add(m(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), M.capRed, 1.5, radius + 0.8, z));
  }
  const branch = m(new THREE.CylinderGeometry(0.5, 0.8, 7, 6), bark, -3, radius + 2, halfLength * 0.4);
  branch.rotation.z = 0.8;
  g.add(branch);
  return g;
}

/** Scenery on the horizon, far outside the fence. */
export function buildBackdrop(kind: 'mountains' | 'dunes' | 'skyline', rand: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const count = kind === 'skyline' ? 60 : 22;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.2;
    const dist = (kind === 'dunes' ? 230 : 260) + rand() * 90;
    const x = Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    if (kind === 'mountains') {
      const h = 60 + rand() * 70;
      const mtn = m(new THREE.ConeGeometry(45 + rand() * 30, h, 6), mat(rand() < 0.5 ? 0x5d7a55 : 0x6f8a60), x, h / 2 - 2, z);
      mtn.castShadow = false;
      g.add(mtn);
      const snow = m(new THREE.ConeGeometry(12 + h * 0.08, h * 0.25, 6), M.snow, x, h - h * 0.125 - 2, z);
      snow.castShadow = false;
      g.add(snow);
    } else if (kind === 'dunes') {
      const dune = m(new THREE.SphereGeometry(40 + rand() * 35, 10, 6), mat(rand() < 0.5 ? 0xe2b86e : 0xd9ab5e), x, -4, z);
      dune.scale.y = 0.28;
      dune.castShadow = false;
      g.add(dune);
    } else {
      const { obj } = buildProp('building', rand);
      obj.scale.setScalar(1.6 + rand() * 1.8);
      obj.position.set(x, 0, z);
      obj.traverse((o) => (o.castShadow = false));
      g.add(obj);
    }
  }
  return g;
}
