import * as THREE from 'three';

const MAX_SEGMENTS = 1200;
const HALF_WIDTH = 0.16;

/**
 * Tyre marks left while drifting: a ring buffer of thin quads on the ground.
 * Oldest marks are overwritten once the buffer is full.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private next = 0;
  private attr: THREE.BufferAttribute;

  constructor() {
    this.pos = new Float32Array(MAX_SEGMENTS * 4 * 3);
    const idx: number[] = [];
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const k = i * 4;
      idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setIndex(idx);
    // Bounds never change in a useful way; skip culling instead of recomputing.
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x2b2733,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Adds one mark segment from `a` to `b` (ground-level points). */
  add(a: THREE.Vector3, b: THREE.Vector3): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05 || len > 3) return;
    const nx = (-dz / len) * HALF_WIDTH;
    const nz = (dx / len) * HALF_WIDTH;
    const o = this.next * 12;
    const p = this.pos;
    p.set([a.x + nx, a.y, a.z + nz, a.x - nx, a.y, a.z - nz, b.x + nx, b.y, b.z + nz, b.x - nx, b.y, b.z - nz], o);
    this.attr.addUpdateRange(o, 12);
    this.attr.needsUpdate = true;
    this.next = (this.next + 1) % MAX_SEGMENTS;
  }

  clear(): void {
    this.pos.fill(0);
    this.attr.clearUpdateRanges();
    this.attr.needsUpdate = true;
    this.next = 0;
  }
}
