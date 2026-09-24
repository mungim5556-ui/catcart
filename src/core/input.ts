/** Normalized driving input, independent of the device it came from. */
export interface KartInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (brake, then reverse)
  steer: number; // -1 (left) .. 1 (right)
  drift: boolean; // hop / drift button held
  driftPressed: boolean; // drift button went down this frame
  reset: boolean; // put kart back on the road
}

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  reset: ['KeyR'],
};

/** Keyboard + gamepad input. Keyboard steering is smoothed so it feels less twitchy. */
export class Input {
  private down = new Set<string>();
  private smoothSteer = 0;
  private prevDrift = false;
  private pressedOnce = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (Object.values(KEYS).some((k) => k.includes(e.code))) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedOnce.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** Returns true once per key press (for toggles like the help panel). */
  consumePress(code: string): boolean {
    const had = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return had;
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  read(dt: number): KartInput {
    let throttle = this.any(KEYS.throttle) ? 1 : 0;
    let brake = this.any(KEYS.brake) ? 1 : 0;
    const target = (this.any(KEYS.right) ? 1 : 0) - (this.any(KEYS.left) ? 1 : 0);
    const rate = target === 0 ? 10 : 6;
    this.smoothSteer += (target - this.smoothSteer) * Math.min(1, rate * dt);
    let steer = this.smoothSteer;
    let drift = this.any(KEYS.drift);
    let reset = this.consumePress('KeyR');

    // Standard-mapping gamepad: left stick steers, RT/A accelerate, LT/B brake, RB/LB drift.
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.15) steer = ax;
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0, pad.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0, pad.buttons[1]?.pressed ? 1 : 0);
      drift = drift || !!pad.buttons[5]?.pressed || !!pad.buttons[4]?.pressed;
      reset = reset || !!pad.buttons[3]?.pressed;
    }

    const driftPressed = drift && !this.prevDrift;
    this.prevDrift = drift;
    return { throttle, brake, steer, drift, driftPressed, reset };
  }
}
