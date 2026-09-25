/**
 * All game audio, synthesized with the Web Audio API (no sound files).
 * The context can only start after a user gesture, so everything is a no-op
 * until unlock() has been called from a key press or click.
 */

type Song = 'menu' | 'race' | null;

const PREFS_KEY = 'catcart.sound.v1';
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// --- Music: C - Am - F - G, eight bars of eighth notes (-1 = rest) ---
const CHORD_ROOTS = [48, 45, 41, 43, 48, 45, 41, 43];
const MELODY = [
  [72, 76, 79, 76, 77, 76, 74, 72],
  [72, 69, 72, 76, 74, 72, 69, -1],
  [69, 72, 77, 76, 74, 72, 74, 76],
  [79, 77, 76, 74, 71, 74, 79, -1],
  [76, 79, 84, 79, 81, 79, 76, 74],
  [76, 72, 69, 72, 76, 79, 76, -1],
  [77, 76, 74, 72, 74, 76, 77, 79],
  [79, -1, 74, -1, 71, 72, 74, -1],
];

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;

  // Continuous voices
  private engineOsc: OscillatorNode[] = [];
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private skidFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;

  // Music sequencer
  private song: Song = null;
  private wantSong: Song = null;
  private nextStep = 0;
  private stepIndex = 0;
  private tempo = 1;

  enabled = true;

  constructor() {
    try {
      this.enabled = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'true');
    } catch {
      /* default on */
    }
  }

  /** Call from any user gesture; creates/resumes the audio context. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.build();
      setInterval(() => this.schedule(), 25);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.enabled));
    } catch {
      /* ignore */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.enabled ? 0.8 : 0, this.ctx.currentTime, 0.05);
    return this.enabled;
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.32;
    this.music.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Engine: two detuned buzzy oscillators through a lowpass.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.sfx);
    for (const [type, detune] of [['sawtooth', 0], ['square', 7]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 60;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = type === 'square' ? 0.35 : 0.6;
      o.connect(g).connect(this.engineFilter);
      o.start();
      this.engineOsc.push(o);
    }

    // Tyre squeal (drift) and grass rumble: looped noise through filters.
    const loop = (type: BiquadFilterType, freq: number, q: number): [GainNode, BiquadFilterNode] => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.sfx);
      src.start();
      return [g, f];
    };
    [this.skidGain, this.skidFilter] = loop('bandpass', 2200, 6);
    [this.rumbleGain] = loop('lowpass', 180, 1);
  }

  // ---------- continuous sounds ----------

  /** Per frame: player engine, drift squeal and off-road rumble. */
  drive(speed: number, throttle: number, boosting: boolean, drifting: boolean, driftLevel: number, offroad: boolean, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = Math.min(1.4, Math.abs(speed) / 26);
    const base = 55 + s * 110 + (boosting ? 30 : 0);
    for (const o of this.engineOsc) o.frequency.setTargetAtTime(base, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(400 + s * 900 + throttle * 300, t, 0.08);
    this.engineGain.gain.setTargetAtTime(active ? 0.05 + throttle * 0.05 + s * 0.04 : 0, t, 0.1);

    this.skidGain.gain.setTargetAtTime(active && drifting ? 0.07 : 0, t, 0.05);
    this.skidFilter.frequency.setTargetAtTime(1800 + driftLevel * 450, t, 0.1);
    this.rumbleGain.gain.setTargetAtTime(active && offroad && s > 0.15 ? 0.35 * s : 0, t, 0.08);
  }

  // ---------- one-shot helpers ----------

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; to?: number; at?: number; attack?: number; dest?: AudioNode } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = opts.at ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'square';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const g = ctx.createGain();
    const vol = opts.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, opts: { freq?: number; to?: number; q?: number; type?: BiquadFilterType; vol?: number; at?: number; dest?: AudioNode } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = opts.at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1000, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.vol ?? 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(opts.dest ?? this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private arp(notes: number[], gap: number, dur: number, type: OscillatorType = 'square', vol = 0.12): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    notes.forEach((n, i) => this.tone(midi(n), dur, { type, vol, at: t + i * gap }));
  }

  // ---------- game sounds ----------

  countdown(go: boolean): void {
    this.tone(go ? 880 : 440, go ? 0.6 : 0.25, { type: 'square', vol: 0.18 });
  }

  boost(kind: 'pad' | 'rocket' | 'fish' | 'catnip' | 'trick' | number): void {
    this.burst(0.6, { freq: 400, to: 3000, q: 2, vol: 0.35 });
    const top = typeof kind === 'number' ? 600 + kind * 200 : 900;
    this.tone(200, 0.45, { type: 'sawtooth', vol: 0.08, to: top });
  }

  driftLevel(level: number): void {
    this.tone(midi(76 + level * 4), 0.15, { type: 'triangle', vol: 0.15 });
  }

  trick(): void {
    this.arp([72, 79, 84, 91], 0.045, 0.12, 'triangle', 0.13);
    this.burst(0.35, { freq: 600, to: 2500, q: 3, vol: 0.18 });
  }

  hop(): void {
    this.tone(300, 0.12, { type: 'triangle', vol: 0.12, to: 520 });
  }

  land(impact: number): void {
    this.tone(120, 0.18, { type: 'sine', vol: Math.min(0.4, impact * 0.03), to: 50 });
  }

  bump(): void {
    this.tone(90, 0.2, { type: 'sine', vol: 0.35, to: 40 });
    this.burst(0.12, { freq: 400, type: 'lowpass', vol: 0.25 });
  }

  itemBox(): void {
    this.arp([79, 84, 88], 0.05, 0.12, 'triangle', 0.12);
  }

  rouletteTick(): void {
    this.tone(1200, 0.03, { type: 'square', vol: 0.05 });
  }

  itemGot(): void {
    this.arp([84, 91], 0.07, 0.18, 'triangle', 0.14);
  }

  throwYarn(): void {
    this.tone(500, 0.15, { type: 'triangle', vol: 0.18, to: 180 });
    this.burst(0.15, { freq: 1500, to: 600, vol: 0.15 });
  }

  dropBanana(): void {
    this.burst(0.18, { freq: 700, to: 250, type: 'lowpass', vol: 0.35 });
    this.tone(260, 0.12, { type: 'sine', vol: 0.12, to: 140 });
  }

  /** A little synthesized "nyaa": rising then falling pitch through a vowel-ish filter. */
  meow(vol = 0.22): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(820, t + 0.12);
    o.frequency.linearRampToValueAtTime(560, t + 0.45);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 5;
    f1.frequency.setValueAtTime(900, t);
    f1.frequency.linearRampToValueAtTime(1600, t + 0.15);
    f1.frequency.linearRampToValueAtTime(700, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(f1).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.55);
  }

  hitSomeone(): void {
    this.tone(700, 0.12, { type: 'square', vol: 0.12, to: 300 });
    this.meow(0.1);
  }

  lap(final: boolean): void {
    if (final) this.arp([72, 76, 79, 84, 79, 84], 0.09, 0.2, 'square', 0.13);
    else this.arp([79, 84], 0.1, 0.25, 'triangle', 0.16);
  }

  finish(place: number): void {
    const notes = place <= 3 ? [72, 76, 79, 84, 88, 91, 96] : [72, 71, 69, 67];
    this.arp(notes, 0.11, 0.35, 'square', 0.13);
    this.setSong(null);
  }

  menuMove(): void {
    this.tone(660, 0.05, { type: 'square', vol: 0.07 });
  }

  menuSelect(): void {
    this.arp([76, 83], 0.05, 0.1, 'square', 0.09);
  }

  // ---------- music ----------

  setSong(song: Song): void {
    this.wantSong = song;
  }

  /** 1 = normal; > 1 speeds the race music up (final lap). */
  setTempo(t: number): void {
    this.tempo = t;
  }

  /** Softer music while paused. */
  duck(on: boolean): void {
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.1 : 0.32, this.ctx.currentTime, 0.1);
    if (on) this.drive(0, 0, false, false, 0, false, false);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.wantSong !== this.song) {
      this.song = this.wantSong;
      this.stepIndex = 0;
      this.nextStep = ctx.currentTime + 0.1;
    }
    if (!this.song) return;
    const bpm = (this.song === 'race' ? 150 : 108) * this.tempo;
    const eighth = 60 / bpm / 2;
    while (this.nextStep < ctx.currentTime + 0.12) {
      this.playStep(this.stepIndex, this.nextStep, eighth);
      this.stepIndex = (this.stepIndex + 1) % 64;
      this.nextStep += eighth;
    }
  }

  private playStep(i: number, t: number, eighth: number): void {
    const bar = Math.floor(i / 8);
    const beat = i % 8;
    const root = CHORD_ROOTS[bar];
    const race = this.song === 'race';
    const m = this.music;

    // Bass: root / octave bounce.
    this.tone(midi(root + (beat % 2 ? 12 : 0) - 12), eighth * 0.9, { type: 'triangle', vol: 0.35, at: t, dest: m });

    // Melody (menu plays it softer on a triangle).
    const n = MELODY[bar][beat];
    if (n > 0) this.tone(midi(n), eighth * (race ? 0.8 : 1.4), { type: race ? 'square' : 'triangle', vol: race ? 0.1 : 0.16, at: t, dest: m });

    // Chord stabs on the off-beats in the race song.
    if (race && beat % 2 === 1) {
      for (const k of [0, bar % 4 === 1 ? 3 : 4, 7]) this.tone(midi(root + 12 + k), eighth * 0.5, { type: 'square', vol: 0.025, at: t, dest: m });
    }

    // Drums.
    if (beat % 4 === 0) this.tone(150, 0.12, { type: 'sine', vol: 0.5, to: 45, at: t, dest: m });
    if (race && beat % 4 === 2) this.burst(0.12, { freq: 1800, q: 0.8, vol: 0.25, at: t, dest: m });
    if (race || beat % 2 === 0) this.burst(0.03, { freq: 8000, type: 'highpass', vol: 0.08, at: t, dest: m });
  }
}
