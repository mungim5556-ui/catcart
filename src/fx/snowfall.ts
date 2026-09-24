import * as THREE from 'three';

const COUNT = 1800;
const BOX = 90; // side of the snowy box around the camera
const HEIGHT = 40;

/** Gently falling snow that follows the camera (only on snowy tracks). */
export class Snowfall {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private drift: Float32Array;

  constructor() {
    this.pos = new Float32Array(COUNT * 3);
    this.drift = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * BOX;
      this.pos[i * 3 + 1] = Math.random() * HEIGHT;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.drift[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    // Soft round flake sprite (points are square otherwise).
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: new THREE.CanvasTexture(c),
        size: 0.22,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  update(dt: number, center: THREE.Vector3): void {
    if (!this.points.visible) return;
    const p = this.pos;
    for (let i = 0; i < COUNT; i++) {
      this.drift[i] += dt;
      p[i * 3] += Math.sin(this.drift[i]) * dt * 0.6;
      p[i * 3 + 1] -= dt * (2.5 + (i % 5) * 0.4);
      if (p[i * 3 + 1] < 0) p[i * 3 + 1] += HEIGHT;
    }
    // Keep the box centred on the camera; wrap flakes that fall behind.
    this.points.position.set(Math.round(center.x), 0, Math.round(center.z));
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
