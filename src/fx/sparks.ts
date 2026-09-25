import * as THREE from 'three';

/** Colors for drift level 0 (dust) and mini-turbo levels 1-3. */
export const DRIFT_COLORS = [0xfff4e0, 0x4fc3ff, 0xffa53d, 0xd46bff];

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  size: number;
  life: number;
  maxLife: number;
}

/**
 * Pooled particles for drift sparks, dust, hits and confetti, drawn as one
 * instanced mesh (a single draw call however many are alive). Particles
 * shrink away at the end of their life instead of fading.
 */
export class Sparks {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private pool: Particle[] = [];
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private color = new THREE.Color();

  constructor(count = 160) {
    this.mesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < count; i++) {
      this.pool.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), size: 1, life: 0, maxLife: 1 });
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
    this.group.add(this.mesh);
  }

  emit(at: THREE.Vector3, color: number, spread = 3, up = 3, life = 0.4, size = 1): void {
    const i = this.next;
    const p = this.pool[i];
    this.next = (this.next + 1) % this.pool.length;
    p.pos.copy(at);
    p.size = size;
    p.vel.set((Math.random() - 0.5) * spread, Math.random() * up, (Math.random() - 0.5) * spread);
    p.rot.set(Math.random() * 6, Math.random() * 6, 0);
    p.life = p.maxLife = life * (0.7 + Math.random() * 0.6);
    this.mesh.setColorAt(i, this.color.set(color));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    let visible = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vel.y -= 12 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.rot.x += dt * 10;
        p.rot.y += dt * 7;
      }
      // Dead particles collapse to zero size (cheaper than compacting the buffer).
      const k = p.life > 0 ? p.size * Math.min(1, (p.life / p.maxLife) * 1.6) : 0;
      if (k > 0) visible = i + 1;
      this.m.compose(p.pos, this.q.setFromEuler(p.rot), this.s.setScalar(k));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = visible;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
