import * as THREE from 'three';
import './style.css';
import { Input, type KartInput } from './core/input';
import { ChaseCamera } from './core/chaseCamera';
import { KART, KartPhysics } from './kart/kartPhysics';
import { ROSTER } from './kart/catKart';
import { SAMPLES, Track } from './world/track';
import { Sparks, DRIFT_COLORS } from './fx/sparks';
import { Hud } from './ui/hud';
import { RaceHud } from './ui/raceHud';
import { LapTracker } from './race/lapTracker';
import { RaceSession, TOTAL_LAPS } from './race/raceSession';
import { IDLE_INPUT, Racer, collideKarts } from './race/racer';
import { ItemSystem, type ItemEvent } from './items/items';
import { ItemHud } from './ui/itemHud';
import { DIFFICULTIES, Menus, type Difficulty } from './ui/menus';

const STEP = 1 / 60;
const SKY = 0xbfe6ff;
/** Grid slot the player starts from (0 = pole, 5 = last). */
const PLAYER_SLOT = 3;
/** How hard AI behind the player is pulled forward (per track sample of gap).
 *  How hard AI ahead eases off depends on the difficulty. */
const CATCH_UP_BEHIND = 0.0007;

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

// --- World & racers ---
const track = new Track();
scene.add(track.group);

const player = new Racer(ROSTER[0], true, track);
const rivals = ROSTER.slice(1).map((c) => new Racer(c, false, track));
const racers = [player, ...rivals];
for (const r of racers) scene.add(r.root);
let difficulty: Difficulty = DIFFICULTIES[1];

/** Player becomes `catIndex`; everyone else in the roster races as AI. */
function assignCats(catIndex: number): void {
  player.setCharacter(ROSTER[catIndex]);
  ROSTER.filter((_, i) => i !== catIndex).forEach((c, i) => rivals[i].setCharacter(c));
}

const items = new ItemSystem(track);
scene.add(items.group);
const itemHud = new ItemHud();

const sparks = new Sparks(320);
scene.add(sparks.group);

const chase = new ChaseCamera(window.innerWidth / window.innerHeight);
const input = new Input();
const hud = new Hud();
const race = new RaceSession();
const raceHud = new RaceHud(track);
/** Race clock that keeps running after the player finishes, for AI finish times. */
let clock = 0;
/** Test hook: replaces keyboard input (used by automated play-tests). */
let inputOverride: (() => KartInput) | null = null;

function placeOnGrid(): void {
  // Rivals get a shuffled grid order each race so nobody always starts on pole.
  const order = [...rivals].sort(() => Math.random() - 0.5);
  // Preferred lanes are shuffled too: a fixed inside line is a big advantage.
  const lanes = [-2, -1, 0, 1, 2].sort(() => Math.random() - 0.5);
  rivals.forEach((r, i) => (r.ai.profile.laneBias = lanes[i]));
  let slot = 0;
  for (const r of order) {
    if (slot === PLAYER_SLOT) slot++;
    r.place(track.gridPose(slot++));
  }
  player.place(track.gridPose(PLAYER_SLOT));
  chase.snap(player.physics);
}

function restartRace(): void {
  placeOnGrid();
  clock = 0;
  race.restart();
  raceHud.hideResults();
  items.clear();
  mode = 'race';
  input.clearPresses();
}

// --- Game flow: title → cat select → race ⇄ pause ---
type Mode = 'title' | 'select' | 'race' | 'paused';
let mode: Mode = 'title';
let menuTime = 0;

const menus = new Menus(ROSTER, {
  onPreview: (i) => assignCats(i),
  onStart: (i, d) => {
    assignCats(i);
    difficulty = d;
    restartRace();
  },
  onResume: () => {
    mode = 'race';
    input.clearPresses();
  },
  onRestart: () => restartRace(),
  onQuit: () => goToTitle(),
});

function goToTitle(): void {
  mode = 'title';
  raceHud.hideResults();
  items.clear();
  assignCats(menus.cat);
  placeOnGrid();
  menus.show('title');
  input.clearPresses();
}

function pause(): void {
  if (mode !== 'race' || race.phase === 'finished') return;
  mode = 'paused';
  input.clearPresses(); // don't let drift/steer taps from the race drive the menu
  menus.show('pause');
}
document.addEventListener('visibilitychange', () => document.hidden && pause());
window.addEventListener('blur', pause);
raceHud.onAction((a) => (a === 'again' ? restartRace() : goToTitle()));
goToTitle();

/** Finished racers by finish time, then everyone else by distance covered. */
function standings(): Racer[] {
  return [...racers].sort((a, b) => {
    if (a.finished || b.finished) {
      if (a.finished && b.finished) return a.finishTime! - b.finishTime!;
      return a.finished ? -1 : 1;
    }
    return b.tracker.distance - a.tracker.distance;
  });
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  chase.camera.aspect = window.innerWidth / window.innerHeight;
  chase.camera.updateProjectionMatrix();
});

// --- Effects ---
function playerStepEffects(): void {
  const kart = player.physics;
  const e = kart.events;
  if (e.boost !== null) {
    if (e.boost === 'pad') hud.flash('부스트!', '#ffb300');
    else if (e.boost === 'rocket') hud.flash('로켓 스타트!', '#ff6f91');
    else if (e.boost === 'fish') hud.flash('생선 부스트!', '#4fc3ff');
    else hud.flash(['', '미니 터보!', '슈퍼 터보!', '울트라 터보!'][e.boost], '#' + DRIFT_COLORS[e.boost].toString(16));
    chase.bump(0.25);
  }
  if (e.hit) chase.bump(0.5);
  if (e.landed > 6) {
    chase.bump(Math.min(0.4, e.landed * 0.03));
    for (let i = 0; i < 12; i++) sparks.emit(kart.pos.clone().setY(kart.pos.y + 0.2), 0xf3ead8, 8, 2.5, 0.5, 2);
  }
}

function frameEffects(r: Racer): void {
  const kart = r.physics;
  // Skip particles for karts far from the camera.
  if (!r.isPlayer && kart.pos.distanceToSquared(player.physics.pos) > 80 * 80) return;
  const rear = r.model.rearWheelPoints();
  if (kart.drifting && kart.grounded) {
    const color = DRIFT_COLORS[kart.driftLevel];
    const size = kart.driftLevel ? 1.3 : 1.8;
    for (const p of rear) sparks.emit(p, color, 3, kart.driftLevel ? 4 : 1.5, 0.35, size);
  } else if (kart.offroad && kart.grounded && Math.abs(kart.forwardSpeed) > 5) {
    if (Math.random() < 0.5) sparks.emit(rear[Math.floor(Math.random() * 2)], 0xc9a27a, 2, 2, 0.4, 1.8);
  }
}

function itemEffects(e: ItemEvent): void {
  if (e.type !== 'hit') return;
  const near = e.victim.physics.pos.distanceToSquared(player.physics.pos) < 60 * 60;
  if (near) {
    const at = e.victim.physics.pos.clone().setY(e.victim.physics.pos.y + 1.2);
    for (let i = 0; i < 14; i++) sparks.emit(at, i % 2 ? 0xffe066 : 0xffffff, 7, 5, 0.6, 1.6);
  }
  if (e.victim === player) {
    hud.flash(e.item === 'banana' ? '미끄덩!' : '냐앙!', '#ff5a6e');
    chase.bump(0.7);
  } else if (e.by === player) {
    hud.flash(`${e.victim.name} 명중!`, '#ffb300');
  }
}

// --- Simulation step ---
function onFinish(): void {
  if (race.phase === 'finished') raceHud.showResults(race, standings(), player);
}

function step(): void {
  for (const r of racers) r.beginStep();

  // Player input goes through the race session (countdown lock, timing).
  const gated = race.step(STEP, inputOverride ? inputOverride() : input.read(STEP));
  if (gated.started) {
    raceHud.go();
    if (race.rocketStart) player.physics.rocketStart();
    for (const r of rivals) if (Math.random() < r.rocketChance) r.physics.rocketStart();
  }
  const others = racers.map((r) => r.physics);
  const racing = race.phase !== 'countdown';
  const order = standings();
  const hazards = items.hazards;

  if (race.phase === 'racing' && gated.input.useItem) items.use(player, order);
  if (racing) for (const r of rivals) if (items.aiWantsToUse(r, order)) items.use(r, order);

  // After the finish line the player's kart drives itself.
  player.lastInput =
    race.phase === 'finished' ? player.ai.drive(player.physics, player.tracker, others, STEP, hazards) : gated.input;
  player.physics.speedMul = race.phase === 'finished' ? 0.85 : 1;

  const playerDist = player.tracker.distance;
  for (const r of rivals) {
    r.lastInput = racing ? r.ai.drive(r.physics, r.tracker, others, STEP, hazards) : IDLE_INPUT;
    // Catch-up: AI far ahead eases off, AI far behind pushes a little harder.
    const gap = r.tracker.distance - playerDist;
    const pull = 1 - gap * (gap > 0 ? difficulty.catchUpAhead : CATCH_UP_BEHIND);
    const catchUp = race.phase === 'racing' ? Math.max(0.86, Math.min(1.1, pull)) : 1;
    r.physics.speedMul = r.pace * difficulty.aiPace * catchUp;
  }

  for (const r of racers) {
    r.physics.step(STEP, r.lastInput, track);
    if (r.lastInput.reset) {
      r.snapRender();
      if (r.isPlayer) chase.snap(r.physics);
    }
  }
  for (const r of collideKarts(racers, KART.radius)) {
    r.physics.events.hit = true;
    r.physics.drifting = false;
  }
  if (racing) for (const e of items.update(STEP, racers, order)) itemEffects(e);
  playerStepEffects();

  for (const r of racers) {
    if (!r.tracker.update(r.physics.pos, r.physics.vel, STEP)) continue;
    if (r.isPlayer) {
      if (race.completeLap()) {
        player.finishTime = race.time;
        onFinish();
      } else if (race.currentLap === TOTAL_LAPS) hud.flash('마지막 랩!', '#ff6f91');
      else hud.flash(`LAP ${race.currentLap}`, '#ffffff');
    } else if (!r.finished && r.tracker.lap >= TOTAL_LAPS && race.phase !== 'countdown') {
      r.finishTime = clock;
      onFinish();
    }
  }
  if (race.phase === 'racing') clock = race.time;
  else if (race.phase === 'finished') clock += STEP;
  // Drift press edge is consumed by the first step that sees it.
  player.lastInput.driftPressed = false;
}

// --- Menu cameras ---
const MENU_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Enter', 'NumpadEnter', 'Space', 'Escape', 'KeyP'];
const lookAt = new THREE.Vector3();

function menuCamera(dt: number): void {
  menuTime += dt;
  const cam = chase.camera;
  if (menus.screen !== 'select') {
    // Slow, high orbit around the start grid.
    const c = track.points[SAMPLES - 8];
    const a = menuTime * 0.1;
    cam.position.set(c.x + Math.sin(a) * 26, 15, c.z + Math.cos(a) * 26);
    lookAt.set(c.x, 1, c.z);
  } else {
    // Close-up of the player's cat, swinging gently from side to side.
    const k = player.physics;
    const f = k.forward;
    const side = Math.sin(menuTime * 0.6) * 2.5;
    cam.position.set(k.pos.x + f.x * 5.5 + f.z * side, k.pos.y + 2.4, k.pos.z + f.z * 5.5 - f.x * side);
    lookAt.set(k.pos.x - f.z * 0.9, k.pos.y + 1.3, k.pos.z + f.x * 0.9);
  }
  cam.fov = 55;
  cam.updateProjectionMatrix();
  cam.lookAt(lookAt);
}

// --- Main loop: fixed-step physics, interpolated rendering ---
let acc = 0;
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;

  if (mode === 'race') {
    if (input.consumePress('KeyH')) hud.toggleHelp();
    const enter = input.consumePress('Enter') || input.consumePress('NumpadEnter');
    const esc = input.consumePress('Escape') || input.consumePress('KeyP');
    if (race.phase === 'finished') {
      if (enter) restartRace();
      else if (esc) goToTitle();
    } else if (esc) pause();
  } else {
    for (const code of MENU_KEYS) if (input.consumePress(code)) menus.key(code);
  }

  if (mode === 'race') {
    while (acc >= STEP) {
      step();
      acc -= STEP;
    }
  } else acc = 0;

  const alpha = mode === 'race' ? acc / STEP : 1;
  for (const r of racers) {
    r.interpolate(alpha);
    r.model.update(r.physics, r.lastInput.steer, dt, r.renderPos, r.renderYaw);
    frameEffects(r);
  }
  if (mode !== 'paused') sparks.update(dt);
  if (mode === 'race') chase.update(player.physics, player.renderPos, dt);
  else if (mode !== 'paused') menuCamera(dt);
  hud.update(player.physics, dt);
  itemHud.update(player, dt);
  raceHud.update(race, player, standings());

  sun.position.set(player.renderPos.x + 30, 60, player.renderPos.z + 20);
  sun.target.position.copy(player.renderPos);

  renderer.render(scene, chase.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for tuning from the browser console: window.catcart.KART.maxSpeed = 30
Object.assign(window, {
  catcart: {
    player, rivals, racers, track, scene, KART, KartPhysics, race, raceHud, LapTracker, RaceSession, standings, items,
    step, restartRace, menus,
    setInputOverride: (fn: (() => KartInput) | null) => (inputOverride = fn),
  },
});
