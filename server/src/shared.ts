/** Bits shared by the worker and both Durable Objects. */

export interface Env {
  HUB: DurableObjectNamespace<import('./hub').Hub>;
  ROOMS: DurableObjectNamespace<import('./room').Room>;
}

export interface UserInfo {
  id: number;
  nickname: string | null;
}

export interface RoomSettings {
  /** Human seats (2–6). */
  maxPlayers: number;
  /** Fill the empty grid slots (up to 6 karts) with computer cats. */
  fillAI: boolean;
  /** Track index (0–5). */
  track: number;
  /** Difficulty index (0–2). */
  difficulty: number;
}

export const DEFAULT_SETTINGS: RoomSettings = { maxPlayers: 4, fillAI: true, track: 0, difficulty: 1 };

/** Clamps untrusted settings into range. */
export function cleanSettings(raw: Partial<RoomSettings> | undefined, base: RoomSettings = DEFAULT_SETTINGS): RoomSettings {
  const int = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
  return {
    maxPlayers: int(raw?.maxPlayers, 2, 6, base.maxPlayers),
    fillAI: typeof raw?.fillAI === 'boolean' ? raw.fillAI : base.fillAI,
    track: int(raw?.track, 0, 5, base.track),
    difficulty: int(raw?.difficulty, 0, 2, base.difficulty),
  };
}

export const CORS: Record<string, string> = {
  // Auth is a bearer token (never a cookie), so any origin may call the API: the web page,
  // the Mac/iPhone apps (app://game) and local development.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
}

export function error(status: number, code: string, message: string): Response {
  return json({ error: code, message }, status);
}
