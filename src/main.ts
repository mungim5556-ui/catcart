import * as THREE from 'three';
import './style.css';
import { Input, type KartInput } from './core/input';
import { TouchControls } from './core/touch';
import { ChaseCamera } from './core/chaseCamera';
import { KART, KartPhysics } from './kart/kartPhysics';
import { ROSTER } from './kart/catKart';
import { SAMPLES, Track } from './world/track';
import { CUPS, TRACKS } from './world/trackDefs';
import { Snowfall } from './fx/snowfall';
import { Sparks, DRIFT_COLORS } from './fx/sparks';
import { Hud } from './ui/hud';
import { RaceHud } from './ui/raceHud';
import { LapTracker } from './race/lapTracker';
import { RaceSession, TOTAL_LAPS } from './race/raceSession';
import { IDLE_INPUT, Racer, collideKarts } from './race/racer';
import { ItemSystem, type ItemEvent } from './items/items';
import { ItemHud } from './ui/itemHud';
import { GameAudio } from './audio/audio';
import { SkidMarks } from './fx/skidMarks';
import { DIFFICULTIES, Menus, type Difficulty } from './ui/menus';
import type { CupView } from './ui/raceHud';

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

const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x7cc25c, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 150 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
// Night tracks: a warm light rides along with the player's kart.
const kartLight = new THREE.PointLight(0xffe2b8, 0, 45, 1.3);
scene.add(kartLight);

// --- World & racers ---
let trackIndex = 0;
let track = new Track(TRACKS[trackIndex]);
scene.add(track.group);
const snowfall = new Snowfall();
scene.add(snowfall.points);

const player = new Racer(ROSTER[0], true, track);
const rivals = ROSTER.slice(1).map((c) => new Racer(c, false, track));
const racers = [player, ...rivals];
for (const r of racers) scene.add(r.root);
let difficulty: Difficulty = DIFFICULTIES[1];
/** Points per finishing place in the cup, and the cup in progress (null = single race). */
const CUP_POINTS = [10, 7, 5, 3, 2, 1];
let cup: { cup: number; race: number; points: Map<Racer, number> } | null = null;

/** Track indices of the cup in progress. */
function cupTracks(): number[] {
  return cup ? CUPS[cup.cup].tracks.map((id) => TRACKS.findIndex((t) => t.id === id)) : [];
}

/** Player becomes `catIndex`; everyone else in the roster races as AI. */
function assignCats(catIndex: number): void {
  player.setCharacter(ROSTER[catIndex]);
  ROSTER.filter((_, i) => i !== catIndex).forEach((c, i) => rivals[i].setCharacter(c));
}

let items = new ItemSystem(track);
scene.add(items.group);
const itemHud = new ItemHud();

const audio = new GameAudio();
// Browsers only allow sound after a user gesture.
for (const ev of ['keydown', 'pointerdown'] as const) window.addEventListener(ev, () => audio.unlock(), { capture: true });

const skids = new SkidMarks();
scene.add(skids.mesh);
/** Last rear-wheel ground points per racer while drifting (for tyre marks). */
const skidPrev = new Map<Racer, THREE.Vector3[]>();
let confetti = 0;
const speedlines = document.getElementById('speedlines')!;

const sparks = new Sparks(320);
scene.add(sparks.group);

const chase = new ChaseCamera(window.innerWidth / window.innerHeight);
const input = new Input();
const touch = new TouchControls();
input.touch = touch;
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
  skids.clear();
  skidPrev.clear();
  confetti = 0;
  lastCount = null;
  if (menus.screen !== 'none') menus.show('none');
  mode = 'race';
  input.clearPresses();
  touch.clearTaps();
  audio.duck(false);
  audio.setTempo(1);
  audio.setSong('race');
  const name = `${track.def.emoji} ${track.def.name}`;
  hud.flash(cup ? `${CUPS[cup.cup].name} ${cup.race + 1}/${cupTracks().length} · ${name}` : name, '#ffffff');
}

// --- Game flow: title → cat select → race ⇄ pause ---
type Mode = 'title' | 'select' | 'race' | 'paused';
let mode: Mode = 'title';
let menuTime = 0;

const menus = new Menus(ROSTER, {
  onPreview: (i) => assignCats(i),
  onPreviewTrack: (i) => {
    loadTrack(i);
    placeOnGrid();
  },
  onStart: (i, d, mode, t, c) => {
    if (touch.active) enterMobileRace();
    assignCats(i);
    difficulty = d;
    if (mode === 'cup') startCup(c);
    else {
      cup = null;
      loadTrack(t);
      restartRace();
    }
  },
  onResume: () => {
    mode = 'race';
    input.clearPresses();
    touch.clearTaps();
    audio.duck(false);
  },
  onRestart: () => restartRace(),
  onQuit: () => goToTitle(),
  onToggleSound: () => audio.toggle(),
  soundOn: () => audio.enabled,
  onSound: (k) => (k === 'move' ? audio.menuMove() : audio.menuSelect()),
  touchMode: () => (touch.active ? touch.mode : null),
  onToggleTouchMode: () => {
    touch.setMode(touch.mode === 'tilt' ? 'buttons' : 'tilt');
    if (touch.mode === 'tilt') void touch.requestTilt();
  },
  onRecenter: () => touch.calibrate(),
});

function goToTitle(): void {
  mode = 'title';
  cup = null;
  loadTrack(menus.track);
  raceHud.hideResults();
  items.clear();
  assignCats(menus.cat);
  placeOnGrid();
  menus.show('title');
  input.clearPresses();
  skids.clear();
  skidPrev.clear();
  confetti = 0;
  audio.duck(false);
  audio.setTempo(1);
  audio.setSong('menu');
}

/** Phones: ask for the tilt sensor (iOS needs a tap for this) and go fullscreen landscape. */
function enterMobileRace(): void {
  if (touch.mode === 'tilt') void touch.requestTilt();
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (!document.fullscreenElement) {
    const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
    try {
      const p = req?.() as Promise<void> | undefined;
      p?.then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {}))
        .catch(() => {});
    } catch {
      /* not supported (iOS Safari): play in the browser window */
    }
  }
}

function pause(): void {
  if (mode !== 'race' || race.phase === 'finished') return;
  mode = 'paused';
  input.clearPresses(); // don't let drift/steer taps from the race drive the menu
  menus.show('pause');
  audio.duck(true);
}
document.addEventListener('visibilitychange', () => document.hidden && pause());
window.addEventListener('blur', pause);
raceHud.onAction(resultAction);
applyTheme();
goToTitle();

/** Switches the whole world to another track (scene, items, minimap, records). */
function loadTrack(i: number): void {
  if (i === trackIndex) return;
  trackIndex = i;
  scene.remove(track.group, items.group);
  track.dispose();
  track = new Track(TRACKS[i]);
  items = new ItemSystem(track);
  scene.add(track.group, items.group);
  for (const r of racers) r.setTrack(track);
  raceHud.setTrack(track);
  race.setTrack(track.def.id);
  skids.clear();
  skidPrev.clear();
  applyTheme();
}

function applyTheme(): void {
  const t = track.theme;
  (scene.background as THREE.Color).setHex(t.sky);
  scene.fog = new THREE.Fog(t.sky, t.fog[0], t.fog[1]);
  document.body.style.background = '#' + t.sky.toString(16).padStart(6, '0');
  hemi.color.setHex(t.hemi[0]);
  hemi.groundColor.setHex(t.hemi[1]);
  hemi.intensity = t.hemi[2];
  sun.color.setHex(t.sun[0]);
  sun.intensity = t.sun[1];
  snowfall.points.visible = !!t.snow;
  hud.setSurface(t.offroad.label, t.offroad.badge);
  kartLight.intensity = t.night ? 120 : 0;
}

// --- Cup mode: three tracks in a row, points by finishing position ---

function cupView(): CupView | undefined {
  if (!cup) return undefined;
  const order = standings();
  const table = racers.map((r) => {
    const gained = CUP_POINTS[order.indexOf(r)] ?? 0;
    return { racer: r, gained, points: (cup!.points.get(r) ?? 0) + gained };
  });
  // Ties go to whoever placed better in this race.
  table.sort((a, b) => b.points - a.points || order.indexOf(a.racer) - order.indexOf(b.racer));
  const n = cupTracks().length;
  return { name: CUPS[cup.cup].name, race: cup.race + 1, total: n, final: cup.race === n - 1, table };
}

function startCup(which = cup?.cup ?? 0): void {
  cup = { cup: which, race: 0, points: new Map() };
  loadTrack(cupTracks()[0]);
  restartRace();
}

function nextCupRace(): void {
  if (!cup) return;
  for (const row of cupView()!.table) cup.points.set(row.racer, row.points);
  cup.race++;
  loadTrack(cupTracks()[cup.race]);
  restartRace();
}

function resultAction(a: 'again' | 'menu' | 'next'): void {
  if (a === 'next') nextCupRace();
  else if (a === 'again') (cup ? startCup() : restartRace());
  else goToTitle();
}

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
    audio.boost(e.boost);
  }
  if (e.hit) {
    chase.bump(0.5);
    audio.bump();
  }
  if (e.hop) audio.hop();
  if (kart.driftLevel > lastDriftLevel) audio.driftLevel(kart.driftLevel);
  lastDriftLevel = kart.driftLevel;
  if (e.landed > 6) {
    audio.land(e.landed);
    chase.bump(Math.min(0.4, e.landed * 0.03));
    for (let i = 0; i < 12; i++) sparks.emit(kart.pos.clone().setY(kart.pos.y + 0.2), 0xf3ead8, 8, 2.5, 0.5, 2);
  }
}

function frameEffects(r: Racer): void {
  const kart = r.physics;
  // Skip particles for karts far from the camera.
  if (!r.isPlayer && kart.pos.distanceToSquared(player.physics.pos) > 80 * 80) {
    skidPrev.delete(r);
    return;
  }
  const rear = r.model.rearWheelPoints();
  // Tyre marks while drifting or spinning out.
  if ((kart.drifting || kart.spinTime > 0) && kart.grounded) {
    const pts = rear.map((p) => p.clone().setY(track.heightAt(p.x, p.z) + 0.03));
    const prev = skidPrev.get(r);
    if (prev) pts.forEach((p, i) => skids.add(prev[i], p));
    skidPrev.set(r, pts);
  } else skidPrev.delete(r);
  if (kart.drifting && kart.grounded) {
    const color = DRIFT_COLORS[kart.driftLevel];
    const size = kart.driftLevel ? 1.3 : 1.8;
    for (const p of rear) sparks.emit(p, color, 3, kart.driftLevel ? 4 : 1.5, 0.35, size);
  } else if (kart.offroad && kart.grounded && Math.abs(kart.forwardSpeed) > 5) {
    if (Math.random() < 0.5) sparks.emit(rear[Math.floor(Math.random() * 2)], track.theme.offroad.dust, 2, 2, 0.4, 1.8);
  }
}

function itemEffects(e: ItemEvent): void {
  if (e.type === 'got' && e.racer === player) audio.itemGot();
  if (e.type === 'used' && e.racer === player) {
    if (e.item === 'yarn') audio.throwYarn();
    else if (e.item === 'banana') audio.dropBanana();
  }
  if (e.type !== 'hit') return;
  const near = e.victim.physics.pos.distanceToSquared(player.physics.pos) < 60 * 60;
  if (near) {
    const at = e.victim.physics.pos.clone().setY(e.victim.physics.pos.y + 1.2);
    for (let i = 0; i < 14; i++) sparks.emit(at, i % 2 ? 0xffe066 : 0xffffff, 7, 5, 0.6, 1.6);
  }
  if (e.victim === player) {
    hud.flash(e.item === 'banana' ? '미끄덩!' : '냐앙!', '#ff5a6e');
    chase.bump(0.7);
    audio.meow();
  } else if (e.by === player) {
    hud.flash(`${e.victim.name} 명중!`, '#ffb300');
    audio.hitSomeone();
  } else if (near) audio.meow(0.06);
}

// --- Simulation step ---
function onFinish(): void {
  if (race.phase === 'finished') raceHud.showResults(race, standings(), player, cupView());
}

function step(): void {
  for (const r of racers) r.beginStep();

  // Player input goes through the race session (countdown lock, timing).
  input.countdown = race.phase === 'countdown';
  // Whatever angle the phone is held at during the countdown becomes "straight".
  if (race.phase === 'countdown') touch.calibrate();
  const gated = race.step(STEP, inputOverride ? inputOverride() : input.read(STEP));
  const count = race.countdownLabel;
  if (count !== lastCount && count !== null) audio.countdown(false);
  lastCount = count;
  if (gated.started) {
    audio.countdown(true);
    raceHud.go();
    if (race.rocketStart) player.physics.rocketStart();
    for (const r of rivals) if (Math.random() < r.rocketChance) r.physics.rocketStart();
  }
  const others = racers.map((r) => r.physics);
  const racing = race.phase !== 'countdown';
  const order = standings();
  const hazards = items.hazards;

  if (race.phase === 'racing' && gated.input.useItem) {
    const used = items.use(player, order);
    if (used) itemEffects(used);
  }
  const hadRoulette = player.roulette > 0;
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
  if (!hadRoulette && player.roulette > 0) audio.itemBox();
  playerStepEffects();

  for (const r of racers) {
    if (!r.tracker.update(r.physics.pos, r.physics.vel, STEP)) continue;
    if (r.isPlayer) {
      if (race.completeLap()) {
        player.finishTime = race.time;
        audio.finish(standings().indexOf(player) + 1);
        confetti = 2.5;
        onFinish();
      } else if (race.currentLap === TOTAL_LAPS) {
        hud.flash('마지막 랩!', '#ff6f91');
        audio.lap(true);
        audio.setTempo(1.12);
      } else {
        hud.flash(`LAP ${race.currentLap}`, '#ffffff');
        audio.lap(false);
      }
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

// --- Per-frame audio & screen effects ---
let lastDriftLevel = 0;
let lastCount: number | null = null;
let tickTimer = 0;
const CONFETTI = [0xff6f91, 0xffb300, 0x4fc3ff, 0x52c77a, 0xc9a4ff, 0xffffff];

function frameAudio(dt: number): void {
  if (input.consumePress('KeyM')) {
    audio.toggle();
    menus.refresh();
  }
  const k = player.physics;
  const racing = mode === 'race';
  audio.drive(k.forwardSpeed, player.lastInput.throttle, k.boostTime > 0, k.drifting && k.grounded, k.driftLevel, k.offroad && k.grounded, racing);
  speedlines.classList.toggle('on', racing && k.boostTime > 0);

  // Roulette clicks.
  if (racing && player.roulette > 0) {
    tickTimer -= dt;
    if (tickTimer <= 0) {
      audio.rouletteTick();
      tickTimer = 0.07;
    }
  }

  // Finish-line confetti rains around the player for a couple of seconds.
  if (confetti > 0 && mode !== 'paused') {
    confetti -= dt;
    for (let i = 0; i < 5; i++) {
      const at = k.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, 5 + Math.random() * 3, (Math.random() - 0.5) * 12));
      sparks.emit(at, CONFETTI[Math.floor(Math.random() * CONFETTI.length)], 3, 1, 1.4, 1.8);
    }
  }
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
    // The select panel covers the bottom of the screen, so frame the cat in
    // the space above it (view offset) and back off when that space is small.
    const h = window.innerHeight;
    const barH = document.querySelector<HTMLElement>('.select-bar')?.offsetHeight ?? 0;
    const titleH = 60;
    const covered = Math.min(0.8, (barH + titleH) / h);
    const dist = 5 + 5 * covered;
    const k = player.physics;
    const f = k.forward;
    const side = Math.sin(menuTime * 0.6) * 2;
    cam.position.set(k.pos.x + f.x * dist + f.z * side, k.pos.y + 2.2, k.pos.z + f.z * dist - f.x * side);
    lookAt.set(k.pos.x, k.pos.y + 1.1, k.pos.z);
    cam.setViewOffset(window.innerWidth, h, 0, (barH - titleH) / 2, window.innerWidth, h);
  }
  if (menus.screen !== 'select' && cam.view?.enabled) cam.clearViewOffset();
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
    if (touch.consumeTap('pause')) {
      if (race.phase === 'finished') goToTitle();
      else pause();
    }
    const enter = input.consumePress('Enter') || input.consumePress('NumpadEnter');
    const esc = input.consumePress('Escape') || input.consumePress('KeyP');
    if (race.phase === 'finished') {
      if (enter) resultAction(cup && !cupView()!.final ? 'next' : 'again');
      else if (esc) goToTitle();
    } else if (esc) pause();
  } else {
    for (const code of MENU_KEYS) if (input.consumePress(code)) menus.key(code);
  }

  touch.show(mode === 'race' && race.phase !== 'finished');
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
  if (mode !== 'paused') {
    sparks.update(dt);
    snowfall.update(dt, chase.camera.position);
  }
  if (mode === 'race') {
    if (chase.camera.view?.enabled) chase.camera.clearViewOffset();
    chase.update(player.physics, player.renderPos, dt);
  }
  else if (mode !== 'paused') menuCamera(dt);
  hud.update(player.physics, dt);
  frameAudio(dt);
  itemHud.update(player, dt);
  raceHud.update(race, player, standings());

  if (kartLight.intensity > 0) {
    const f = player.physics.forward;
    kartLight.position.set(player.renderPos.x + f.x * 3, player.renderPos.y + 4, player.renderPos.z + f.z * 3);
  }
  sun.position.set(player.renderPos.x + 30, 60, player.renderPos.z + 20);
  sun.target.position.copy(player.renderPos);

  renderer.render(scene, chase.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for tuning from the browser console: window.catcart.KART.maxSpeed = 30
Object.assign(window, {
  catcart: {
    player, rivals, racers, scene, KART, KartPhysics, race, raceHud, LapTracker, RaceSession, standings,
    get track() {
      return track;
    },
    get items() {
      return items;
    },
    loadTrack, startCup, nextCupRace,
    get cup() {
      return cup;
    },
    step, restartRace, menus, audio,
    setInputOverride: (fn: (() => KartInput) | null) => (inputOverride = fn),
  },
});
