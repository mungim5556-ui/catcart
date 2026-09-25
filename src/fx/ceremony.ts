import * as THREE from 'three';
import type { CatStyle } from '../kart/catKart';

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...extra });

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A standing cat (no kart) that can wave. Faces +Z. */
class StandingCat {
  readonly root = new THREE.Group();
  private wave = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();

  constructor(style: CatStyle, trophy: boolean) {
    const fur = mat(style.fur);
    const light = mat(style.furLight);
    const pink = mat(0xff9eb5);
    const dark = mat(0x2d2d3a);
    const white = mat(0xffffff);

    for (const x of [-0.25, 0.25]) this.root.add(mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.6, 6), fur, x, 0.3, 0));
    for (const x of [-0.25, 0.25]) this.root.add(mesh(new THREE.IcosahedronGeometry(0.2, 0), light, x, 0.08, 0.12));
    const body = mesh(new THREE.IcosahedronGeometry(0.62, 1), fur, 0, 1.05, 0);
    body.scale.set(0.95, 1.15, 0.85);
    this.root.add(body);
    this.root.add(mesh(new THREE.IcosahedronGeometry(0.4, 1), light, 0, 1.0, 0.3));
    // Scarf in the racer's kart colour.
    const scarf = mesh(new THREE.TorusGeometry(0.42, 0.11, 5, 12), mat(style.kart), 0, 1.62, 0);
    scarf.rotation.x = Math.PI / 2;
    this.root.add(scarf);

    // Head (same look as the kart driver).
    const h = this.head;
    h.position.set(0, 2.15, 0);
    const skull = mesh(new THREE.IcosahedronGeometry(0.55, 1), fur);
    skull.scale.set(1.1, 0.9, 1);
    h.add(skull);
    h.add(mesh(new THREE.IcosahedronGeometry(0.24, 0), light, 0, -0.15, 0.42));
    h.add(mesh(new THREE.TetrahedronGeometry(0.08), pink, 0, -0.04, 0.6));
    for (const side of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.22, 0.42, 4), fur, side * 0.33, 0.5, 0);
      ear.rotation.z = -side * 0.35;
      h.add(ear);
      const inner = mesh(new THREE.ConeGeometry(0.11, 0.24, 4), pink, side * 0.33, 0.47, 0.08);
      inner.rotation.z = -side * 0.35;
      h.add(inner);
      // Happy closed eyes: little arcs.
      const eye = mesh(new THREE.TorusGeometry(0.08, 0.025, 4, 8, Math.PI), dark, side * 0.22, 0.05, 0.5);
      h.add(eye);
      for (const dy of [-0.13, -0.21]) {
        const w = mesh(new THREE.BoxGeometry(0.38, 0.015, 0.015), white, side * 0.38, dy, 0.44);
        w.rotation.z = side * (dy + 0.17) * 1.5;
        h.add(w);
      }
    }
    const band = mesh(new THREE.TorusGeometry(0.52, 0.055, 4, 10), mat(style.kart), 0, 0.17, -0.02);
    band.rotation.x = Math.PI / 2;
    band.scale.set(1.12, 1, 1);
    h.add(band);
    this.root.add(h);

    // Waving right arm (pivots at the shoulder).
    this.wave.position.set(0.55, 1.5, 0.05);
    this.wave.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.75, 6), fur, 0, 0.35, 0));
    this.wave.add(mesh(new THREE.IcosahedronGeometry(0.19, 0), light, 0, 0.78, 0));
    this.root.add(this.wave);

    // Left arm: down, or holding up the trophy for the winner.
    const left = new THREE.Group();
    left.position.set(-0.55, 1.5, 0.05);
    left.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.75, 6), fur, 0, 0.35, 0));
    left.add(mesh(new THREE.IcosahedronGeometry(0.19, 0), light, 0, 0.78, 0));
    if (trophy) {
      left.rotation.z = 0.5;
      const gold = mat(0xf2c14e, { metalness: 0.6, roughness: 0.3 });
      const cup = new THREE.Group();
      cup.add(mesh(new THREE.CylinderGeometry(0.28, 0.12, 0.45, 10), gold, 0, 0.35, 0));
      cup.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6), gold, 0, 0.05, 0));
      cup.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 8), gold, 0, -0.06, 0));
      for (const x of [-0.3, 0.3]) {
        const handle = mesh(new THREE.TorusGeometry(0.1, 0.025, 4, 8), gold, x, 0.38, 0);
        handle.rotation.y = Math.PI / 2;
        cup.add(handle);
      }
      cup.position.set(0, 0.95, 0);
      cup.rotation.z = -0.5;
      left.add(cup);
    } else left.rotation.z = 2.9; // hanging down at the side
    this.root.add(left);

    // Tail curling up behind.
    this.tail.position.set(0, 0.7, -0.5);
    let parent: THREE.Object3D = this.tail;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0 : 0.28, 0);
      seg.rotation.x = -0.4;
      seg.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 5), i === 3 ? light : fur, 0, 0.14, 0));
      parent.add(seg);
      parent = seg;
    }
    this.root.add(this.tail);
  }

  update(t: number, place: number): void {
    // Wave: arm raised, paw swinging side to side. The winner hops too.
    // rotation.z = θ turns the up-pointing arm to (-sin θ, cos θ): about -0.5 is raised to the side.
    this.wave.rotation.z = -0.5 + Math.sin(t * 9 + place) * 0.45;
    this.head.rotation.z = Math.sin(t * 3 + place) * 0.12;
    this.tail.rotation.z = Math.sin(t * 4 + place) * 0.4;
    this.root.position.y = place === 1 ? Math.abs(Math.sin(t * 5)) * 0.35 : Math.abs(Math.sin(t * 3 + place)) * 0.08;
  }
}

function numberTexture(n: number, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  g.font = 'bold 96px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const STEPS = [
  { place: 1, x: 0, h: 3, color: 0xf2c14e, css: '#e0a92e' },
  { place: 2, x: -3.6, h: 2.2, color: 0xcfd6e2, css: '#a8b3c4' },
  { place: 3, x: 3.6, h: 1.5, color: 0xe09a5a, css: '#c27a3c' },
];

/** The cup ceremony stage: podium, the top three cats waving, balloons and bunting. */
export class Ceremony {
  readonly group = new THREE.Group();
  private cats: { cat: StandingCat; place: number }[] = [];
  private time = 0;

  start(top3: CatStyle[]): void {
    this.stop();
    this.time = 0;
    const g = this.group;

    const stage = mesh(new THREE.CylinderGeometry(14, 14.5, 0.5, 24), mat(0xfff1dc), 0, 0.25, 0);
    stage.receiveShadow = true;
    g.add(stage);
    const carpet = mesh(new THREE.BoxGeometry(3.4, 0.05, 12), mat(0xff5a6e), 0, 0.52, 6);
    carpet.receiveShadow = true;
    g.add(carpet);

    STEPS.forEach((s, i) => {
      const block = mesh(new THREE.BoxGeometry(3.4, s.h, 3), mat(s.color, { metalness: 0.2 }), s.x, 0.5 + s.h / 2, 0);
      block.receiveShadow = true;
      g.add(block);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: numberTexture(s.place, s.css) }));
      plate.position.set(s.x, 0.5 + s.h / 2, 1.51);
      g.add(plate);
      const style = top3[i];
      if (!style) return;
      const cat = new StandingCat(style, s.place === 1);
      const base = new THREE.Group();
      base.position.set(s.x, 0.5 + s.h, 0);
      base.add(cat.root);
      g.add(base);
      this.cats.push({ cat, place: s.place });
    });

    // Balloons and a string of bunting over the podium.
    const colors = [0xff6f91, 0xffb300, 0x4fc3ff, 0x52c77a, 0xc9a4ff];
    for (let i = 0; i < 10; i++) {
      const side = i < 5 ? -1 : 1;
      const x = side * (7 + (i % 5) * 1.3);
      const y = 4 + ((i * 7) % 5) * 0.8;
      const z = -1 - (i % 3) * 1.5;
      const balloon = mesh(new THREE.SphereGeometry(0.7, 10, 8), mat(colors[i % colors.length], { roughness: 0.4 }), x, y, z);
      balloon.scale.y = 1.2;
      g.add(balloon);
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, y - 0.5, 4), mat(0xffffff));
      string.position.set(x, (y - 0.5) / 2 + 0.3, z);
      g.add(string);
    }
    for (let i = 0; i < 17; i++) {
      const x = -8 + i;
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 3), mat(colors[i % colors.length], { side: THREE.DoubleSide }));
      flag.position.set(x, 7.6 - Math.cos((x / 8) * Math.PI * 0.5) * 0.8, -1.8);
      flag.rotation.x = Math.PI;
      g.add(flag);
    }
  }

  /** Winner-area centre, for the camera and lights. */
  get focus(): THREE.Vector3 {
    return new THREE.Vector3(0, 3.2, 0);
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.time += dt;
    for (const { cat, place } of this.cats) cat.update(this.time, place);
    // Slow swing in front of the podium.
    const a = Math.sin(this.time * 0.25) * 0.35;
    camera.position.set(Math.sin(a) * 14, 5.2, Math.cos(a) * 14);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 3.3, 0);
  }

  stop(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.MeshStandardMaterial;
        m.map?.dispose();
        m.dispose();
      }
    });
    this.group.clear();
    this.cats = [];
  }
}
