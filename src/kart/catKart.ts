import * as THREE from 'three';
import { mergeStatic } from '../world/mergeStatic';
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

/** How a cat drives when the computer controls it. */
export interface AiTraits {
  pace: number; // top-speed scale (1 = same as the player)
  driftSkill: number; // chance to drift a big corner
  rocketChance: number; // chance of a rocket start
}

export interface CatCharacter {
  name: string;
  trait: string;
  style: CatStyle;
  ai: AiTraits;
}

/** Every selectable cat. Whoever the player doesn't pick races as AI. */
export const ROSTER: CatCharacter[] = [
  { name: '치즈', trait: '호기심 많은 치즈냥', style: GINGER, ai: { pace: 0.935, driftSkill: 0.55, rocketChance: 0.35 } },
  {
    name: '까망이',
    trait: '밤을 달리는 검은 번개',
    style: { kart: 0x7a5cff, kartTrim: 0xffe066, fur: 0x2f2b36, furLight: 0x6d6778 },
    ai: { pace: 0.94, driftSkill: 0.6, rocketChance: 0.4 },
  },
  {
    name: '설기',
    trait: '새하얀 모범생',
    style: { kart: 0x4fc3ff, kartTrim: 0xffffff, fur: 0xf7f4ee, furLight: 0xffffff },
    ai: { pace: 0.95, driftSkill: 0.7, rocketChance: 0.4 },
  },
  {
    name: '고등어',
    trait: '느긋한 줄무늬 대장',
    style: { kart: 0x52c77a, kartTrim: 0xffffff, fur: 0x8f929c, furLight: 0xd9dbe0 },
    ai: { pace: 0.94, driftSkill: 0.6, rocketChance: 0.35 },
  },
  {
    name: '삼색이',
    trait: '행운을 부르는 삼색냥',
    style: { kart: 0xffb300, kartTrim: 0x3a2e4f, fur: 0xe07b39, furLight: 0xffffff },
    ai: { pace: 0.93, driftSkill: 0.45, rocketChance: 0.3 },
  },
  {
    name: '샴',
    trait: '도도한 파란 눈의 귀족',
    style: { kart: 0xff5a6e, kartTrim: 0xfff1dc, fur: 0xe9dcc4, furLight: 0x6b4f3f },
    ai: { pace: 0.915, driftSkill: 0.3, rocketChance: 0.2 },
  },
];

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
  /** 📦 Box shield: see-through cardboard box around the kart. */
  private shieldBox: THREE.Group;
  /** 🌿 Catnip: pulsing green glow. */
  private aura: THREE.Mesh;

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

    // Item effect overlays (hidden until used).
    this.shieldBox = new THREE.Group();
    const boxGeo = new THREE.BoxGeometry(2.7, 2.6, 3.6);
    const faces = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xc9a06a, transparent: true, opacity: 0.18, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), new THREE.LineBasicMaterial({ color: 0x8a6a3f }));
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 3.62), new THREE.MeshBasicMaterial({ color: 0xe8d9b0 }));
    tape.position.y = 1.3;
    this.shieldBox.add(faces, edges, tape);
    this.shieldBox.position.y = 1.2;
    this.shieldBox.visible = false;
    this.root.add(this.shieldBox);
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.aura.position.y = 1.1;
    this.aura.visible = false;
    this.root.add(this.aura);

    // Fewer draw calls: merge the parts that never move relative to their parent,
    // keeping animated pieces (cat, head, tail, flames, wheels, overlays) separate.
    for (const o of [this.cat, this.headGroup, this.tail, this.shieldBox, this.aura, ...this.flames]) o.userData.dynamic = true;
    mergeStatic(this.body);
    this.cat.userData.dynamic = false;
    mergeStatic(this.cat);
    this.headGroup.userData.dynamic = false;
    mergeStatic(this.headGroup);
    this.tail.userData.dynamic = false;
    mergeStatic(this.tail);
  }

  /** Frees GPU resources when this model is swapped out. */
  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }

  /** Mirrors physics state into the model and adds juicy secondary motion. */
  update(k: KartPhysics, steer: number, dt: number, pos: THREE.Vector3, yaw: number): void {
    this.time += dt;
    const fs = k.forwardSpeed;
    const damp = (rate: number) => 1 - Math.exp(-rate * dt);

    const targetOffset = k.drifting ? -k.driftDir * 0.3 : 0;
    this.visualYawOffset += (targetOffset - this.visualYawOffset) * damp(8);
    this.root.position.copy(pos);
    // Item hit: one full spin, easing out.
    const sp = k.spinProgress;
    const spin = sp > 0 ? (1 - (1 - sp) ** 2) * Math.PI * 2 : 0;
    // Milk: a quick fishtail wobble that dies down.
    const wobble = k.slipTime > 0 ? Math.sin(this.time * 28) * 0.35 * (k.slipTime / 0.9) : 0;
    this.root.rotation.y = yaw + this.visualYawOffset + spin + wobble;

    // Shield blinks in its last two seconds; catnip glow pulses.
    this.shieldBox.visible = k.shieldTime > 0 && (k.shieldTime > 2 || Math.floor(this.time * 8) % 2 === 0);
    this.aura.visible = k.starTime > 0;
    if (this.aura.visible) {
      const p = 1 + Math.sin(this.time * 12) * 0.08;
      this.aura.scale.set(1.5 * p, 1.1 * p, 1.9 * p);
      (this.aura.material as THREE.MeshBasicMaterial).color.setHSL((this.time * 0.8) % 1 * 0.25 + 0.25, 0.9, 0.55);
    }
    // Blink while immune after a hit.
    this.root.visible = !(k.invulnTime > 0 && k.spinTime <= 0 && Math.floor(this.time * 20) % 2 === 0);

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
