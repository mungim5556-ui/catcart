import * as THREE from 'three';

/** Colors for drift level 0 (dust) and mini-turbo levels 1-3. */
export const DRIFT_COLORS = [0xfff4e0, 0x4fc3ff, 0xffa53d, 0xd46bff];

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

/** Tiny pooled particle system for drift sparks, landing dust and boost bursts. */
export class Sparks {
  readonly group = new THREE.Group();
  private pool: Particle[] = [];
  private next = 0;

  constructor(count = 160) {
    const geo = new THREE.TetrahedronGeometry(0.14);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1 });
    }
  }

  emit(at: THREE.Vector3, color: number, spread = 3, up = 3, life = 0.4, size = 1): void {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.mesh.position.copy(at);
    p.mesh.scale.setScalar(size);
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    p.vel.set((Math.random() - 0.5) * spread, Math.random() * up, (Math.random() - 0.5) * spread);
    p.life = p.maxLife = life * (0.7 + Math.random() * 0.6);
    p.mesh.visible = true;
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= 12 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 10;
      p.mesh.rotation.y += dt * 7;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / p.maxLife;
    }
  }
}
