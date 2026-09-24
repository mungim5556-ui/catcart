import type { KartInput } from '../core/input';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export const TOTAL_LAPS = 3;
const COUNTDOWN = 3.5; // "3", "2", "1" then GO; the first 0.5 s is a beat to settle
const RECORD_KEY = 'catcart.records.v1';

export interface Records {
  bestTotal: number | null;
  bestLap: number | null;
}

function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (raw) return { bestTotal: null, bestLap: null, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: records just won't persist */
  }
  return { bestTotal: null, bestLap: null };
}

function saveRecords(r: Records): void {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}

/** Time-attack race flow: countdown → racing (3 laps) → finished. */
export class RaceSession {
  phase: RacePhase = 'countdown';
  countdown = COUNTDOWN;
  time = 0;
  lapTimes: number[] = [];
  records: Records = loadRecords();
  /** Previous records, kept so the results screen can say "new record!". */
  prevRecords: Records = { ...this.records };
  rocketStart = false;
  private throttleHeld = 0; // how long throttle has been held during the countdown

  restart(): void {
    this.phase = 'countdown';
    this.countdown = COUNTDOWN;
    this.time = 0;
    this.lapTimes = [];
    this.prevRecords = { ...this.records };
    this.rocketStart = false;
    this.throttleHeld = 0;
  }

  get lapStart(): number {
    return this.lapTimes.reduce((a, b) => a + b, 0);
  }

  get currentLap(): number {
    return Math.min(TOTAL_LAPS, this.lapTimes.length + 1);
  }

  /** Countdown number to show (3, 2, 1), 0 for GO, or null for nothing. */
  get countdownLabel(): number | null {
    if (this.phase !== 'countdown') return null;
    const n = Math.ceil(this.countdown);
    return n <= 3 ? n : null;
  }

  /**
   * Advances the race clock and filters the player's input for the current phase.
   * Returns the input the kart should actually receive.
   */
  step(dt: number, input: KartInput): { input: KartInput; started: boolean } {
    let started = false;
    if (this.phase === 'countdown') {
      this.throttleHeld = input.throttle > 0 ? this.throttleHeld + dt : 0;
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        started = true;
        // Rocket start: press accelerate around when "1" appears — not earlier.
        this.rocketStart = this.throttleHeld > 0.1 && this.throttleHeld < 1.1;
      }
      return { input: { ...input, throttle: 0, brake: 0, steer: 0, drift: false, driftPressed: false, reset: false }, started };
    }
    if (this.phase === 'racing') {
      this.time += dt;
      return { input, started };
    }
    // Finished: let the kart roll to a stop.
    return { input: { ...input, throttle: 0, brake: 0.3, drift: false, driftPressed: false }, started };
  }

  /** Call when the tracker reports a completed lap. Returns true if the race just ended. */
  completeLap(): boolean {
    if (this.phase !== 'racing') return false;
    const lap = this.time - this.lapStart;
    this.lapTimes.push(lap);
    if (this.records.bestLap === null || lap < this.records.bestLap) this.records.bestLap = lap;
    if (this.lapTimes.length >= TOTAL_LAPS) {
      this.phase = 'finished';
      if (this.records.bestTotal === null || this.time < this.records.bestTotal) this.records.bestTotal = this.time;
    }
    saveRecords(this.records);
    return this.phase === 'finished';
  }
}

export function formatTime(t: number | null): string {
  if (t === null) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
