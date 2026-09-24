import * as THREE from 'three';
import type { TrackDef } from '../world/trackDefs';

const cache = new Map<string, string>();

/** Top-down outline of a track as an image URL (same orientation as the minimap). */
export function trackPreview(def: TrackDef, size = 150): string {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const curve = new THREE.CatmullRomCurve3(def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const pts = curve.getSpacedPoints(200);
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ);
  const pad = 14;
  const scale = (size - pad * 2) / span;
  const ox = (size - (Math.max(...xs) - minX) * scale) / 2;
  const oz = (size - (Math.max(...zs) - minZ) * scale) / 2;
  const proj = (p: THREE.Vector3): [number, number] => [size - (ox + (p.x - minX) * scale), size - (oz + (p.z - minZ) * scale)];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.lineJoin = 'round';
  const stroke = (color: string, w: number) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(...proj(p)) : g.moveTo(...proj(p))));
    g.strokeStyle = color;
    g.lineWidth = w;
    g.stroke();
  };
  stroke('#ffffff', 11);
  stroke('#' + def.theme.road.toString(16).padStart(6, '0'), 6);
  const [sx, sy] = proj(pts[0]);
  g.fillStyle = '#ff6f91';
  g.beginPath();
  g.arc(sx, sy, 5, 0, Math.PI * 2);
  g.fill();
  const url = c.toDataURL();
  cache.set(def.id, url);
  return url;
}
