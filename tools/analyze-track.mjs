// Track shape checker: corner radii, self-clearance, straights (for pads/ramps).
import * as THREE from 'three';
const N = 400;
const tracks = JSON.parse(process.argv[2]);
for (const [name, pts] of Object.entries(tracks)) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const P = curve.getSpacedPoints(N).slice(0, N), L = curve.getLength(), ds = L / N;
  const head = (i) => { const t = curve.getTangentAt(((i % N) + N) % N / N); return Math.atan2(t.x, t.z); };
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const w = Math.max(1, Math.round(10 / ds));
  const R = [];
  for (let i = 0; i < N; i++) R.push((2 * w * ds) / Math.max(1e-6, Math.abs(wrap(head(i + w) - head(i - w)))));
  // clearance: min distance between samples more than 40 samples apart along the loop
  let clear = Infinity, where = null;
  for (let i = 0; i < N; i++) for (let j = i + 40; j < N; j++) {
    if (N - (j - i) < 40) continue;
    const d = P[i].distanceTo(P[j]); if (d < clear) { clear = d; where = [i, j]; }
  }
  const minR = Math.min(...R), minAt = R.indexOf(minR);
  // straight runs: consecutive samples with R > 80
  const runs = []; let s = -1;
  for (let k = 0; k < N * 2; k++) { const i = k % N; if (R[i] > 80) { if (s < 0) s = k; } else if (s >= 0) { if (k - s >= 12 && s < N) runs.push([s % N, k - s]); s = -1; } }
  const xs = P.map(p => p.x), zs = P.map(p => p.z);
  console.log(`${name}: length ${L.toFixed(0)}m, min corner R ${minR.toFixed(1)}m @t=${(minAt/N).toFixed(3)}, self-clearance ${clear.toFixed(1)}m @t=${where.map(i=>(i/N).toFixed(2))}, bbox x[${Math.min(...xs).toFixed(0)},${Math.max(...xs).toFixed(0)}] z[${Math.min(...zs).toFixed(0)},${Math.max(...zs).toFixed(0)}]`);
  console.log('  straights (t, length in samples):', runs.map(([a, n]) => `${(a/N).toFixed(2)}+${n}`).join(' '));
  console.log('  tight corners (<22m):', R.map((r, i) => r < 22 && r <= R[(i+1)%N] && r <= R[(i-1+N)%N] ? `${(i/N).toFixed(2)}:${r.toFixed(0)}` : null).filter(Boolean).join(' ') || 'none');
}
