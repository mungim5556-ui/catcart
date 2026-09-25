import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges every static mesh under `root` that shares a material (and shadow
 * flags) into one mesh, so a track with ~1000 props draws in a few dozen
 * calls instead of one per prop. Only use on things that never move
 * (relative to `root`): objects with `userData.dynamic` are left alone,
 * including everything below them.
 */
export function mergeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();

  const statics: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D): void => {
    if (o.userData.dynamic) return;
    if (o instanceof THREE.Mesh && !Array.isArray(o.material)) statics.push(o);
    for (const c of o.children) walk(c);
  };
  for (const c of root.children) walk(c);

  for (const o of statics) {
    const geo = o.geometry as THREE.BufferGeometry;
    // Attribute layout must match to merge; key on it along with material and shadow flags.
    const attrs = Object.keys(geo.attributes).sort().join(',');
    const material = o.material as THREE.Material;
    const key = `${material.uuid}|${o.castShadow}|${o.receiveShadow}|${attrs}`;
    let g = groups.get(key);
    if (!g) {
      g = { material, cast: o.castShadow, receive: o.receiveShadow, geos: [], meshes: [] };
      groups.set(key, g);
    }
    // Bake the mesh's transform (relative to root) into a non-indexed copy.
    const baked = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    g.geos.push(baked);
    g.meshes.push(o);
  }

  const oldGeos = new Set<THREE.BufferGeometry>();
  for (const g of groups.values()) {
    if (g.meshes.length < 2) {
      g.geos.forEach((geo) => geo.dispose());
      continue;
    }
    const merged = mergeGeometries(g.geos, false);
    g.geos.forEach((geo) => geo.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    root.add(mesh);
    for (const m of g.meshes) {
      oldGeos.add(m.geometry);
      m.removeFromParent();
    }
  }
  oldGeos.forEach((geo) => geo.dispose());

  // Drop groups that are now empty.
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && o.type === 'Group' && o.children.length === 0 && !o.userData.dynamic) empty.push(o);
  });
  for (const o of empty) o.removeFromParent();
}
