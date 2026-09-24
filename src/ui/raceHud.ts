import type { Track } from '../world/track';
import type { LapTracker } from '../race/lapTracker';
import { RaceSession, TOTAL_LAPS, formatTime } from '../race/raceSession';

const $ = (id: string) => document.getElementById(id)!;

/** Lap/timer panel, countdown, wrong-way warning, minimap and results screen. */
export class RaceHud {
  private lap = $('lap');
  private time = $('time');
  private splits = $('splits');
  private best = $('best');
  private count = $('countdown');
  private wrong = $('wrongway');
  private results = $('results');
  private map = $('minimap') as HTMLCanvasElement;
  private mapCtx = this.map.getContext('2d')!;
  private mapBg: HTMLCanvasElement;
  private lastCount: number | null = null;
  private project: (x: number, z: number) => [number, number];

  constructor(track: Track) {
    // Fit the centre line into the minimap canvas.
    const size = this.map.width;
    const pad = 12;
    const xs = track.points.map((p) => p.x);
    const zs = track.points.map((p) => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * scale) / 2;
    const oz = (size - (maxZ - minZ) * scale) / 2;
    // Mirror X so the map matches what you see from behind the kart at the start.
    this.project = (x, z) => [size - (ox + (x - minX) * scale), size - (oz + (z - minZ) * scale)];

    this.mapBg = document.createElement('canvas');
    this.mapBg.width = this.mapBg.height = size;
    const g = this.mapBg.getContext('2d')!;
    const path = () => {
      g.beginPath();
      track.points.forEach((p, i) => {
        const [x, y] = this.project(p.x, p.z);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
    };
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 9;
    path();
    g.stroke();
    g.strokeStyle = '#6b6f80';
    g.lineWidth = 5;
    path();
    g.stroke();
    // start line tick
    const [sx, sy] = this.project(track.points[0].x, track.points[0].z);
    g.fillStyle = '#ff6f91';
    g.fillRect(sx - 4, sy - 4, 8, 8);
  }

  update(race: RaceSession, tracker: LapTracker, kartX: number, kartZ: number, kartYaw: number): void {
    this.lap.textContent = `${race.currentLap}/${TOTAL_LAPS}`;
    this.time.textContent = formatTime(race.time);
    this.splits.innerHTML = race.lapTimes
      .map((t, i) => `<div>LAP ${i + 1} <span>${formatTime(t)}</span></div>`)
      .join('');
    this.best.textContent = `최고 랩 ${formatTime(race.records.bestLap)}`;

    const n = race.countdownLabel;
    if (n !== this.lastCount) {
      this.lastCount = n;
      if (n !== null) this.popCount(String(n));
    }
    this.wrong.classList.toggle('show', race.phase === 'racing' && tracker.wrongWay);

    // minimap
    const g = this.mapCtx;
    g.clearRect(0, 0, this.map.width, this.map.height);
    g.drawImage(this.mapBg, 0, 0);
    const [x, y] = this.project(kartX, kartZ);
    // Heading arrow (screen space: x mirrored, z flipped).
    const dx = -Math.sin(kartYaw);
    const dy = -Math.cos(kartYaw);
    g.fillStyle = '#f4a340';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + dx * 8, y + dy * 8);
    g.lineTo(x - dx * 5 - dy * 5, y - dy * 5 + dx * 5);
    g.lineTo(x - dx * 5 + dy * 5, y - dy * 5 - dx * 5);
    g.closePath();
    g.fill();
    g.stroke();
  }

  go(): void {
    this.popCount('GO!');
  }

  private popCount(text: string): void {
    this.count.textContent = text;
    this.count.classList.remove('pop');
    void this.count.offsetWidth;
    this.count.classList.add('pop');
  }

  showResults(race: RaceSession): void {
    const prev = race.prevRecords;
    const newTotal = prev.bestTotal === null || race.time < prev.bestTotal;
    const fastest = Math.min(...race.lapTimes);
    const newLap = prev.bestLap === null || fastest < prev.bestLap;
    const rows = race.lapTimes
      .map(
        (t, i) =>
          `<tr class="${t === fastest ? 'fast' : ''}"><td>LAP ${i + 1}</td><td>${formatTime(t)}</td></tr>`,
      )
      .join('');
    this.results.innerHTML = `
      <div class="card">
        <h2>🏁 완주!</h2>
        <div class="total">${formatTime(race.time)}${newTotal ? '<span class="rec">신기록!</span>' : ''}</div>
        <table>${rows}</table>
        <p class="bests">
          최고 기록 ${formatTime(race.records.bestTotal)}<br />
          최고 랩 ${formatTime(race.records.bestLap)}${newLap ? ' <span class="rec">NEW</span>' : ''}
        </p>
        <p class="again"><kbd>Enter</kbd> 다시 달리기</p>
      </div>`;
    this.results.classList.add('show');
  }

  hideResults(): void {
    this.results.classList.remove('show');
  }
}
