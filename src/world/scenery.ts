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
};

const pick = <T>(arr: T[], r: () => number) => arr[Math.floor(r() * arr.length)];

function m(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
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
  }
}
