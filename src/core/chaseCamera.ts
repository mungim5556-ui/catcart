import * as THREE from 'three';
import type { KartPhysics } from '../kart/kartPhysics';

/** Third-person camera that trails the kart and widens its FOV at speed. */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private shake = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(68, aspect, 0.1, 1200);
  }

  snap(k: KartPhysics): void {
    this.yaw = k.yaw;
    this.update(k, k.pos, 1);
  }

  bump(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  update(k: KartPhysics, pos: THREE.Vector3, dt: number): void {
    const damp = (rate: number) => 1 - Math.exp(-rate * dt);
    // Trail the heading with a little lag so turns feel swingy.
    let diff = k.yaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * damp(k.drifting ? 3.5 : 5);

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const speed = Math.max(0, k.forwardSpeed);
    const dist = 7 + speed * 0.06;
    const desired = new THREE.Vector3(pos.x - fx * dist, pos.y + 3.2, pos.z - fz * dist);
    this.camera.position.lerp(desired, damp(10));
    this.camera.position.y = Math.max(this.camera.position.y, pos.y + 1.5);

    this.shake *= Math.exp(-10 * dt);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(pos.x + fx * 4, pos.y + 1.3, pos.z + fz * 4);

    const targetFov = 68 + Math.min(1, speed / 36) * 10 + (k.boostTime > 0 ? 8 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * damp(4);
    this.camera.updateProjectionMatrix();
  }
}
