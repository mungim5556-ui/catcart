/**
 * Phone / tablet controls: on-screen buttons plus tilt steering.
 *
 * Tilt works like a steering wheel: hold the phone (ideally sideways) and
 * rotate it. We turn the device orientation into the direction of "up" as
 * seen on the screen, so it works in portrait, landscape and with the phone
 * held upright or tilted back.
 */

export type SteerMode = 'tilt' | 'buttons';

const PREFS_KEY = 'catcart.touch.v1';
/** Degrees of wheel rotation for full steering lock. */
const FULL_LOCK = 28;
const DEADZONE = 2.5;

type Btn = 'left' | 'right' | 'brake' | 'drift' | 'item' | 'pause' | 'rocket';

/** Phones and tablets (a touchscreen laptop with a mouse still counts as desktop). */
function isTouchDevice(): boolean {
  if (new URLSearchParams(location.search).has('touch')) return true; // for testing on desktop
  return window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : 'ontouchstart' in window;
}

export class TouchControls {
  readonly active = isTouchDevice();
  mode: SteerMode = 'tilt';
  /** Tilt sensor delivered at least one reading. */
  tiltAvailable = false;

  private held = new Set<Btn>();
  private taps = new Map<Btn, number>();
  private rawTilt = 0; // degrees, right = positive
  private center = 0;
  private root: HTMLElement;

  constructor() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
      if (p.mode === 'tilt' || p.mode === 'buttons') this.mode = p.mode;
    } catch {
      /* defaults */
    }
    this.root = document.getElementById('touch')!;
    if (!this.active) return;
    document.body.classList.add('touch');
    this.applyMode();

    // Each button tracks its own finger, so several can be held at once.
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-btn]')) {
      const b = el.dataset.btn as Btn;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId); // keep receiving this finger's events
        } catch {
          /* synthetic or already-released pointer */
        }
        if (!this.held.has(b)) this.taps.set(b, (this.taps.get(b) ?? 0) + 1);
        this.held.add(b);
        el.classList.add('down');
      };
      const up = (e: PointerEvent) => {
        e.preventDefault();
        this.held.delete(b);
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    window.addEventListener('deviceorientation', (e) => this.onOrientation(e));
  }

  // ---------- sensor ----------

  private onOrientation(e: DeviceOrientationEvent): void {
    if (e.beta === null || e.gamma === null) return;
    this.tiltAvailable = true;
    const b = (e.beta * Math.PI) / 180;
    const g = (e.gamma * Math.PI) / 180;
    // World "up" expressed in device coordinates (x right, y towards the top edge).
    const ux = -Math.cos(b) * Math.sin(g);
    const uy = Math.sin(b);
    // Rotate into screen coordinates for the current orientation.
    const a = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) * Math.PI) / 180;
    const right = ux * Math.cos(a) - uy * Math.sin(a);
    const upS = ux * Math.sin(a) + uy * Math.cos(a);
    // Turning the phone clockwise (to steer right) makes "up" lean to the screen's left.
    // max(): stays continuous when the phone lies flat and "up" leaves the screen plane.
    this.rawTilt = (Math.atan2(-right, Math.max(upS, 0.5)) * 180) / Math.PI;
  }

  /** iOS asks for permission to read motion sensors; must be called from a tap. */
  async requestTilt(): Promise<void> {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (DOE?.requestPermission) {
      try {
        await DOE.requestPermission();
      } catch {
        /* denied: the ◀ ▶ buttons still work via the menu setting */
      }
    }
  }

  /** Treat the current hold as straight ahead. */
  calibrate(): void {
    this.center = this.rawTilt;
  }

  get steer(): number {
    if (this.mode === 'buttons' || !this.tiltAvailable) {
      return (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    }
    let d = this.rawTilt - this.center;
    if (Math.abs(d) < DEADZONE) return 0;
    d -= Math.sign(d) * DEADZONE;
    return Math.max(-1, Math.min(1, d / (FULL_LOCK - DEADZONE)));
  }

  isHeld(b: Btn): boolean {
    return this.held.has(b);
  }

  /** True once per tap. */
  consumeTap(b: Btn): boolean {
    const n = this.taps.get(b) ?? 0;
    if (n > 1) this.taps.set(b, n - 1);
    else this.taps.delete(b);
    return n > 0;
  }

  clearTaps(): void {
    this.taps.clear();
  }

  setMode(mode: SteerMode): void {
    this.mode = mode;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ mode }));
    } catch {
      /* ignore */
    }
    this.applyMode();
  }

  private applyMode(): void {
    document.body.classList.toggle('steer-buttons', this.mode === 'buttons');
  }

  /** Buttons are only shown while racing. */
  show(visible: boolean): void {
    this.root.classList.toggle('show', this.active && visible);
    if (!visible) {
      this.held.clear();
      for (const el of this.root.querySelectorAll('.down')) el.classList.remove('down');
    }
  }
}
