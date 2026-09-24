import type { KartPhysics } from '../kart/kartPhysics';
import { KART } from '../kart/kartPhysics';
import { DRIFT_COLORS } from '../fx/sparks';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const LEVEL_NAMES = ['', '미니 터보', '슈퍼 터보', '울트라 터보'];

/** DOM overlay: speedometer, drift charge meter, boost banner, help panel. */
export class Hud {
  private speed = document.getElementById('speed')!;
  private driftBar = document.getElementById('drift-fill')!;
  private driftBox = document.getElementById('drift')!;
  private driftLabel = document.getElementById('drift-label')!;
  private banner = document.getElementById('banner')!;
  private help = document.getElementById('help')!;
  private surface = document.getElementById('surface')!;
  private bannerTimer = 0;

  /** Off-road warning for the current track's terrain. */
  setSurface(label: string, background: string): void {
    this.surface.textContent = label;
    this.surface.style.background = background;
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  setHelp(visible: boolean): void {
    this.help.classList.toggle('hidden', !visible);
  }

  flash(text: string, color: string): void {
    this.banner.textContent = text;
    this.banner.style.color = color;
    this.banner.classList.remove('pop');
    void this.banner.offsetWidth; // restart CSS animation
    this.banner.classList.add('pop');
    this.bannerTimer = 0.9;
  }

  update(k: KartPhysics, dt: number): void {
    this.speed.textContent = String(Math.round(Math.abs(k.forwardSpeed) * 4));
    this.surface.classList.toggle('show', k.offroad && k.boostTime <= 0);

    const max = KART.driftLevels[KART.driftLevels.length - 1];
    this.driftBox.classList.toggle('show', k.drifting);
    if (k.drifting) {
      const level = k.driftLevel;
      this.driftBar.style.width = `${Math.min(1, k.driftCharge / max) * 100}%`;
      this.driftBar.style.background = hex(DRIFT_COLORS[level]);
      this.driftLabel.textContent = level ? LEVEL_NAMES[level] : '드리프트';
      this.driftLabel.style.color = hex(DRIFT_COLORS[level]);
    }

    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.banner.classList.remove('pop');
  }
}
