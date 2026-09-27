import * as THREE from 'three';
import { mergeStatic } from '../world/mergeStatic';

/** Something a cat can wear. Built in head space (head centre at 0, face +Z, skull ~0.5 m). */
export interface Accessory {
  id: string;
  name: string;
  icon: string;
}

export const ACCESSORIES: Accessory[] = [
  { id: 'none', name: '없음', icon: '🚫' },
  { id: 'sunglasses', name: '선글라스', icon: '🕶️' },
  { id: 'strawhat', name: '밀짚모자', icon: '👒' },
  { id: 'ribbon', name: '리본', icon: '🎀' },
  { id: 'crown', name: '왕관', icon: '👑' },
  { id: 'tophat', name: '실크햇', icon: '🎩' },
  { id: 'cap', name: '야구모자', icon: '🧢' },
  { id: 'headphones', name: '헤드폰', icon: '🎧' },
  { id: 'scarf', name: '목도리', icon: '🧣' },
  { id: 'flowers', name: '꽃 화관', icon: '🌼' },
  { id: 'party', name: '고깔모자', icon: '🥳' },
];

const cache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(extra);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, ...extra });
    cache.set(key, m);
  }
  return m;
}

function part(g: THREE.Group, geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/**
 * Builds an accessory. `neck` accessories are placed just under the head, so the caller
 * mounts everything on the head and they still sit right.
 */
export function buildAccessory(id: string): THREE.Group | null {
  const g = new THREE.Group();
  switch (id) {
    case 'sunglasses': {
      const lens = mat(0x1d1d28, { roughness: 0.2, metalness: 0.4 });
      const frame = mat(0xff5a8a);
      for (const s of [-1, 1]) {
        const l = part(g, new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10), lens, s * 0.2, 0.06, 0.5);
        l.rotation.x = Math.PI / 2;
        const rim = part(g, new THREE.TorusGeometry(0.155, 0.025, 4, 12), frame, s * 0.2, 0.06, 0.52);
        rim.rotation.set(0, 0, 0);
        const arm = part(g, new THREE.BoxGeometry(0.03, 0.03, 0.45), frame, s * 0.43, 0.08, 0.3);
        arm.rotation.y = s * 0.25;
      }
      part(g, new THREE.BoxGeometry(0.12, 0.03, 0.03), frame, 0, 0.1, 0.52);
      break;
    }
    case 'strawhat': {
      const straw = mat(0xf1d38a);
      part(g, new THREE.CylinderGeometry(0.85, 0.85, 0.05, 18), straw, 0, 0.36, 0);
      part(g, new THREE.CylinderGeometry(0.36, 0.44, 0.3, 14), straw, 0, 0.52, 0);
      part(g, new THREE.CylinderGeometry(0.45, 0.45, 0.08, 14), mat(0xff5a6e), 0, 0.42, 0);
      g.rotation.x = -0.12;
      break;
    }
    case 'ribbon': {
      const pink = mat(0xff5a8a);
      for (const s of [-1, 1]) {
        const loop = part(g, new THREE.ConeGeometry(0.16, 0.3, 5), pink, s * 0.16, 0, 0);
        loop.rotation.z = s * Math.PI / 2;
      }
      part(g, new THREE.SphereGeometry(0.08, 8, 6), mat(0xffd1e0), 0, 0, 0.02);
      g.position.set(0.28, 0.42, 0.16);
      g.rotation.z = -0.4;
      break;
    }
    case 'crown': {
      const gold = mat(0xffcf3d, { metalness: 0.5, roughness: 0.35 });
      part(g, new THREE.CylinderGeometry(0.27, 0.25, 0.16, 10, 1, true), mat(0xffcf3d, { metalness: 0.5, roughness: 0.35, side: THREE.DoubleSide }), 0, 0.5, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        part(g, new THREE.ConeGeometry(0.07, 0.18, 4), gold, Math.sin(a) * 0.25, 0.66, Math.cos(a) * 0.25);
        part(g, new THREE.SphereGeometry(0.035, 6, 4), mat([0xff4d6d, 0x4fc3ff, 0x5fd86a][i % 3], { emissive: 0x220000 }), Math.sin(a) * 0.26, 0.5, Math.cos(a) * 0.26);
      }
      break;
    }
    case 'tophat': {
      const black = mat(0x23232e);
      part(g, new THREE.CylinderGeometry(0.46, 0.46, 0.04, 14), black, 0, 0.46, 0);
      part(g, new THREE.CylinderGeometry(0.27, 0.27, 0.52, 14), black, 0, 0.74, 0);
      part(g, new THREE.CylinderGeometry(0.28, 0.28, 0.09, 14), mat(0xff5a6e), 0, 0.54, 0);
      g.rotation.z = 0.18;
      break;
    }
    case 'cap': {
      const blue = mat(0x3f7cff);
      const dome = part(g, new THREE.SphereGeometry(0.52, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), blue, 0, 0.12, 0);
      dome.scale.set(1.08, 0.8, 1.02);
      part(g, new THREE.BoxGeometry(0.62, 0.04, 0.42), blue, 0, 0.16, 0.62).rotation.x = -0.12;
      part(g, new THREE.SphereGeometry(0.06, 6, 4), mat(0xffffff), 0, 0.54, 0);
      break;
    }
    case 'headphones': {
      const band = mat(0x3a3d4a);
      const cup = mat(0x7a5cff);
      part(g, new THREE.TorusGeometry(0.56, 0.05, 5, 16, Math.PI), band, 0, 0.05, 0);
      for (const s of [-1, 1]) {
        const c = part(g, new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12), cup, s * 0.58, 0.0, 0);
        c.rotation.z = Math.PI / 2;
        const pad = part(g, new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10), mat(0xffe066), s * 0.67, 0.0, 0);
        pad.rotation.z = Math.PI / 2;
      }
      break;
    }
    case 'scarf': {
      const red = mat(0xff5a6e);
      const stripe = mat(0xffffff);
      const ring = part(g, new THREE.TorusGeometry(0.34, 0.12, 5, 14), red, 0, -0.48, -0.02);
      ring.rotation.x = Math.PI / 2;
      const tail = part(g, new THREE.BoxGeometry(0.2, 0.42, 0.07), red, 0.2, -0.72, 0.3);
      tail.rotation.z = 0.2;
      part(g, new THREE.BoxGeometry(0.21, 0.06, 0.08), stripe, 0.22, -0.64, 0.3).rotation.z = 0.2;
      part(g, new THREE.BoxGeometry(0.21, 0.06, 0.08), stripe, 0.24, -0.8, 0.3).rotation.z = 0.2;
      break;
    }
    case 'flowers': {
      const petals = [mat(0xff8fb8), mat(0xffffff), mat(0xb58fff), mat(0xffa94d)];
      const centre = mat(0xffe066);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = Math.sin(a) * 0.46;
        const z = Math.cos(a) * 0.42;
        part(g, new THREE.IcosahedronGeometry(0.1, 0), petals[i % petals.length], x, 0.3, z).scale.set(1.3, 0.6, 1.3);
        part(g, new THREE.SphereGeometry(0.045, 5, 4), centre, x, 0.35, z);
      }
      for (let i = 0; i < 8; i++) {
        const a = ((i + 0.5) / 8) * Math.PI * 2;
        part(g, new THREE.SphereGeometry(0.06, 5, 3), mat(0x5fb848), Math.sin(a) * 0.47, 0.28, Math.cos(a) * 0.43).scale.set(1.5, 0.5, 1);
      }
      break;
    }
    case 'party': {
      const cone = part(g, new THREE.ConeGeometry(0.22, 0.6, 10), mat(0x4fc3ff), 0, 0.3, 0);
      cone.position.y = 0.3;
      for (const [y, r] of [[0.12, 0.17], [0.32, 0.1]] as const) {
        const band = part(g, new THREE.TorusGeometry(r, 0.03, 4, 10), mat(0xffe066), 0, y, 0);
        band.rotation.x = Math.PI / 2;
      }
      part(g, new THREE.SphereGeometry(0.08, 8, 6), mat(0xff5a8a), 0, 0.62, 0);
      g.position.set(-0.12, 0.42, 0);
      g.rotation.z = 0.28;
      break;
    }
    default:
      return null;
  }
  // One draw call per colour instead of one per piece.
  const wrap = new THREE.Group();
  wrap.add(g);
  mergeStatic(g);
  wrap.name = 'accessory';
  return wrap;
}
