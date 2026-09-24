import * as THREE from 'three';
import type { KartPhysics } from './kartPhysics';

export interface CatStyle {
  kart: number;
  kartTrim: number;
  fur: number;
  furLight: number;
}

export const GINGER: CatStyle = {
  kart: 0xff6f91,
  kartTrim: 0xffffff,
  fur: 0xf4a340,
  furLight: 0xfff1dc,
};

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 });

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Low-poly cat driving a kart, built from primitives. Faces +Z. */
export class CatKart {
  readonly root = new THREE.Group();
  private body = new THREE.Group(); // tilts and squashes; wheels stay planted
  private cat = new THREE.Group();
  private frontPivots: THREE.Group[] = [];
  private wheels: THREE.Mesh[] = [];
  private tail: THREE.Group;
  private flames: THREE.Mesh[] = [];
  private headGroup = new THREE.Group();

  private visualYawOffset = 0;
  private roll = 0;
  private pitch = 0;
  private squash = 0;
  private time = 0;

  constructor(style: CatStyle = GINGER) {
    const kartMat = mat(style.kart);
    const trimMat = mat(style.kartTrim);
    const darkMat = mat(0x2d2d3a);
    const furMat = mat(style.fur);
    const lightMat = mat(style.furLight);
    const pinkMat = mat(0xff9eb5);

    // --- Kart chassis ---
    this.body.add(mesh(new THREE.BoxGeometry(1.5, 0.35, 2.4), kartMat, 0, 0.5, 0));
    const nose = mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.9, 6), kartMat, 0, 0.55, 1.35);
    nose.rotation.x = Math.PI / 2;
    this.body.add(nose);
    this.body.add(mesh(new THREE.BoxGeometry(1.7, 0.12, 0.5), trimMat, 0, 0.72, 1.3)); // bumper stripe
    this.body.add(mesh(new THREE.BoxGeometry(1.2, 0.6, 0.35), kartMat, 0, 0.95, -0.85)); // seat back
    this.body.add(mesh(new THREE.BoxGeometry(1.9, 0.12, 0.45), trimMat, 0, 1.25, -1.15)); // spoiler
    this.body.add(mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), darkMat, -0.6, 1.05, -1.15));
    this.body.add(mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), darkMat, 0.6, 1.05, -1.15));

    // Exhausts + boost flames
    for (const x of [-0.45, 0.45]) {
      const pipe = mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.4, 6), darkMat, x, 0.55, -1.35);
      pipe.rotation.x = Math.PI / 2;
      this.body.add(pipe);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 1, 6),
        new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.85 }),
      );
      flame.position.set(x, 0.55, -1.9);
      flame.rotation.x = -Math.PI / 2;
      flame.visible = false;
      this.body.add(flame);
      this.flames.push(flame);
    }

    // Steering wheel
    const wheelRing = mesh(new THREE.TorusGeometry(0.25, 0.05, 4, 8), darkMat, 0, 1.15, 0.45);
    wheelRing.rotation.x = -Math.PI / 3;
    this.body.add(wheelRing);

    // --- Cat ---
    this.cat.add(mesh(new THREE.IcosahedronGeometry(0.5, 0), furMat, 0, 1.1, -0.3)); // body
    this.cat.add(mesh(new THREE.IcosahedronGeometry(0.32, 0), lightMat, 0, 1.1, -0.02)); // belly
    // paws on the wheel
    this.cat.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), lightMat, -0.22, 1.2, 0.42));
    this.cat.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), lightMat, 0.22, 1.2, 0.42));

    const head = this.headGroup;
    head.position.set(0, 1.75, -0.2);
    const skull = mesh(new THREE.IcosahedronGeometry(0.5, 1), furMat);
    skull.scale.set(1.1, 0.9, 1);
    head.add(skull);
    head.add(mesh(new THREE.IcosahedronGeometry(0.22, 0), lightMat, 0, -0.14, 0.38)); // muzzle
    head.add(mesh(new THREE.TetrahedronGeometry(0.07), pinkMat, 0, -0.04, 0.55)); // nose
    for (const side of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.2, 0.38, 4), furMat, side * 0.3, 0.45, 0);
      ear.rotation.z = -side * 0.35;
      head.add(ear);
      const inner = mesh(new THREE.ConeGeometry(0.1, 0.22, 4), pinkMat, side * 0.3, 0.43, 0.07);
      inner.rotation.z = -side * 0.35;
      head.add(inner);
      head.add(mesh(new THREE.BoxGeometry(0.1, 0.16, 0.05), darkMat, side * 0.2, 0.05, 0.45)); // eye
      head.add(mesh(new THREE.BoxGeometry(0.035, 0.05, 0.02), trimMat, side * 0.18, 0.1, 0.475)); // eye shine
      for (const dy of [-0.12, -0.2]) {
        const whisker = mesh(new THREE.BoxGeometry(0.35, 0.015, 0.015), trimMat, side * 0.35, dy, 0.4);
        whisker.rotation.z = side * (dy + 0.16) * 1.5;
        head.add(whisker);
      }
    }
    // helmet stripe / racing goggles strap
    const band = mesh(new THREE.TorusGeometry(0.47, 0.05, 4, 10), mat(style.kart), 0, 0.15, -0.02);
    band.rotation.x = Math.PI / 2;
    band.scale.set(1.12, 1, 1);
    head.add(band);
    this.cat.add(head);

    // Tail: a chain of segments curling up behind the seat
    this.tail = new THREE.Group();
    this.tail.position.set(0, 1.05, -0.8);
    let parent: THREE.Object3D = this.tail;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0 : 0.28, 0);
      seg.rotation.x = -0.35;
      seg.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 5), i === 3 ? lightMat : furMat, 0, 0.14, 0));
      parent.add(seg);
      parent = seg;
    }
    this.cat.add(this.tail);
    this.body.add(this.cat);
    this.root.add(this.body);

    // --- Wheels ---
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.34, 8);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.36, 6);
    hubGeo.rotateZ(Math.PI / 2);
    for (const [x, z, front] of [
      [-0.9, 0.85, true],
      [0.9, 0.85, true],
      [-0.9, -0.85, false],
      [0.9, -0.85, false],
    ] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.38, z);
      const wheel = mesh(wheelGeo, darkMat);
      wheel.add(mesh(hubGeo, trimMat));
      pivot.add(wheel);
      this.root.add(pivot);
      this.wheels.push(wheel);
      if (front) this.frontPivots.push(pivot);
    }
  }

  /** Mirrors physics state into the model and adds juicy secondary motion. */
  update(k: KartPhysics, steer: number, dt: number, pos: THREE.Vector3, yaw: number): void {
    this.time += dt;
    const fs = k.forwardSpeed;
    const damp = (rate: number) => 1 - Math.exp(-rate * dt);

    const targetOffset = k.drifting ? -k.driftDir * 0.4 : 0;
    this.visualYawOffset += (targetOffset - this.visualYawOffset) * damp(8);
    this.root.position.copy(pos);
    this.root.rotation.y = yaw + this.visualYawOffset;

    const targetRoll = THREE.MathUtils.clamp(k.yawRate * 0.08 * Math.sign(fs || 1), -0.2, 0.2);
    this.roll += (targetRoll - this.roll) * damp(6);
    const targetPitch = k.grounded ? 0 : THREE.MathUtils.clamp(-k.vel.y * 0.03, -0.35, 0.35);
    this.pitch += (targetPitch - this.pitch) * damp(6);
    this.body.rotation.set(this.pitch, 0, this.roll);

    if (k.events.landed > 3) this.squash = Math.min(0.3, k.events.landed * 0.025);
    this.squash *= Math.exp(-8 * dt);
    const rumble = k.offroad && k.grounded ? Math.sin(this.time * 60) * 0.03 * Math.min(1, Math.abs(fs) / 5) : 0;
    this.body.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.5);
    this.body.position.y = rumble;

    for (const w of this.wheels) w.rotation.x += (fs / 0.38) * dt;
    const wheelSteer = k.drifting ? k.driftDir * 0.15 + steer * 0.2 : steer * 0.45;
    for (const p of this.frontPivots) p.rotation.y = -wheelSteer;

    // Cat leans into turns, head bobs, tail sways.
    this.cat.rotation.z = this.roll * 1.5;
    this.headGroup.rotation.y = -steer * 0.3;
    this.headGroup.position.y = 1.75 + Math.sin(this.time * 8) * 0.02 * Math.min(1, Math.abs(fs) / 10);
    this.tail.rotation.z = Math.sin(this.time * 4) * 0.3 - this.roll;

    const boosting = k.boostTime > 0;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) {
        const s = 0.8 + Math.random() * 0.6;
        f.scale.set(1, s, 1);
        f.position.z = -1.55 - s * 0.5;
      }
    }
  }

  /** World positions of the rear wheels' contact points (for sparks). */
  rearWheelPoints(): THREE.Vector3[] {
    return this.wheels.slice(2).map((w) => w.getWorldPosition(new THREE.Vector3()).setY(this.root.position.y + 0.1));
  }
}
