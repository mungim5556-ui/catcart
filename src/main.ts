import * as THREE from 'three';
import './style.css';
import { Input } from './core/input';
import type { KartInput } from './core/input';
import { ChaseCamera } from './core/chaseCamera';
import { KART, KartPhysics } from './kart/kartPhysics';
import { CatKart } from './kart/catKart';
import { Track } from './world/track';
import { Sparks, DRIFT_COLORS } from './fx/sparks';
import { Hud } from './ui/hud';
import { RaceHud } from './ui/raceHud';
import { LapTracker } from './race/lapTracker';
import { RaceSession, TOTAL_LAPS } from './race/raceSession';

const STEP = 1 / 60;
const SKY = 0xbfe6ff;

// --- Renderer & scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 90, 320);

scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x7cc25c, 1.6));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 150 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// --- World ---
const track = new Track();
scene.add(track.group);

const kart = new KartPhysics();
const start = track.startPose();
kart.place(start.pos, start.yaw);

const cat = new CatKart();
scene.add(cat.root);

const sparks = new Sparks();
scene.add(sparks.group);

const chase = new ChaseCamera(window.innerWidth / window.innerHeight);
chase.snap(kart);

const input = new Input();
const hud = new Hud();

const prevPos = kart.pos.clone();
const renderPos = new THREE.Vector3();
let prevYaw = kart.yaw;

const tracker = new LapTracker(track);
tracker.reset(kart.pos);
const race = new RaceSession();
const raceHud = new RaceHud(track);
let firstStart = true;

function restartRace(): void {
  const s = track.startPose();
  kart.place(s.pos, s.yaw);
  tracker.reset(kart.pos);
  race.restart();
  raceHud.hideResults();
  chase.snap(kart);
  prevPos.copy(kart.pos);
  prevYaw = kart.yaw;
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  chase.camera.aspect = window.innerWidth / window.innerHeight;
  chase.camera.updateProjectionMatrix();
});

// --- Per-physics-step effects ---
function stepEffects(): void {
  const e = kart.events;
  if (e.boost !== null) {
    if (e.boost === 'pad') hud.flash('부스트!', '#ffb300');
    else if (e.boost === 'rocket') hud.flash('로켓 스타트!', '#ff6f91');
    else hud.flash(['', '미니 터보!', '슈퍼 터보!', '울트라 터보!'][e.boost], '#' + DRIFT_COLORS[e.boost].toString(16));
    chase.bump(0.25);
  }
  if (e.hit) chase.bump(0.5);
  if (e.landed > 6) {
    chase.bump(Math.min(0.4, e.landed * 0.03));
    for (let i = 0; i < 12; i++) sparks.emit(kart.pos.clone().setY(kart.pos.y + 0.2), 0xf3ead8, 8, 2.5, 0.5, 2);
  }
}

function frameEffects(): void {
  const rear = cat.rearWheelPoints();
  if (kart.drifting && kart.grounded) {
    const color = DRIFT_COLORS[kart.driftLevel];
    const size = kart.driftLevel ? 1.3 : 1.8;
    for (const p of rear) sparks.emit(p, color, 3, kart.driftLevel ? 4 : 1.5, 0.35, size);
  } else if (kart.offroad && kart.grounded && Math.abs(kart.forwardSpeed) > 5) {
    if (Math.random() < 0.5) sparks.emit(rear[Math.floor(Math.random() * 2)], 0xc9a27a, 2, 2, 0.4, 1.8);
  }
}

// --- Main loop: fixed-step physics, interpolated rendering ---
let acc = 0;
let last = performance.now();
let lastInput: KartInput = input.read(0);

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;

  if (input.consumePress('KeyH')) hud.toggleHelp();
  const enter = input.consumePress('Enter') || input.consumePress('NumpadEnter');
  if (enter && race.phase === 'finished') restartRace();

  while (acc >= STEP) {
    prevPos.copy(kart.pos);
    prevYaw = kart.yaw;
    const gated = race.step(STEP, input.read(STEP));
    lastInput = gated.input;
    if (gated.started) {
      raceHud.go();
      if (race.rocketStart) kart.rocketStart();
      if (firstStart) hud.setHelp(false);
      firstStart = false;
    }
    kart.step(STEP, lastInput, track);
    stepEffects();
    if (tracker.update(kart.pos, kart.vel, STEP)) {
      if (race.completeLap()) raceHud.showResults(race);
      else if (race.currentLap === TOTAL_LAPS) hud.flash('마지막 랩!', '#ff6f91');
      else hud.flash(`LAP ${race.currentLap}`, '#ffffff');
    }
    if (lastInput.reset) {
      prevPos.copy(kart.pos);
      prevYaw = kart.yaw;
      chase.snap(kart);
    }
    // Drift press edge is consumed by the first step that sees it.
    lastInput.driftPressed = false;
    acc -= STEP;
  }

  const alpha = acc / STEP;
  renderPos.lerpVectors(prevPos, kart.pos, alpha);
  let dy = kart.yaw - prevYaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const renderYaw = prevYaw + dy * alpha;

  cat.update(kart, lastInput.steer, dt, renderPos, renderYaw);
  frameEffects();
  sparks.update(dt);
  chase.update(kart, renderPos, dt);
  hud.update(kart, dt);
  raceHud.update(race, tracker, renderPos.x, renderPos.z, renderYaw);

  sun.position.set(renderPos.x + 30, 60, renderPos.z + 20);
  sun.target.position.copy(renderPos);

  renderer.render(scene, chase.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for tuning from the browser console: window.catcart.KART.maxSpeed = 30
Object.assign(window, { catcart: { kart, track, scene, KART, KartPhysics, race, tracker, raceHud, LapTracker, RaceSession } });
