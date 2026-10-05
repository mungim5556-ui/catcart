import { DurableObject } from 'cloudflare:workers';
import { cleanSettings, error, type Env, type RoomSettings } from './shared';

interface Member {
  id: number;
  nickname: string;
  cat: number;
  accessory: string;
  ready: boolean;
  ws: WebSocket | null;
  /** Messages this second (flood guard). */
  budget: number;
}

interface Slot {
  kind: 'human' | 'ai';
  id?: number;
  nickname?: string;
  cat: number;
  accessory?: string;
}

interface Saved {
  code: string;
  hostId: number;
  settings: RoomSettings;
  allowed: number[];
  created: number;
}

const ROSTER_SIZE = 6;
const GRID = 6;
/** Rooms nobody joined within this long are dropped. */
const ROOM_TTL = 30 * 60_000;
/** Race traffic forwarded to everyone else in the room. */
const RELAY = new Set(['st', 'ai', 'ev', 'fin']);

/**
 * One race room. Keeps the lobby (settings, members, ready flags) and, during a race,
 * relays each player's kart state and events to the others. The host's game runs the
 * computer cats and shared items; everyone runs their own kart.
 */
export class Room extends DurableObject<Env> {
  private saved: Saved | null = null;
  private loaded = false;
  private members = new Map<number, Member>();
  private phase: 'lobby' | 'race' = 'lobby';

  private async load(): Promise<Saved | null> {
    if (!this.loaded) {
      this.saved = (await this.ctx.storage.get<Saved>('room')) ?? null;
      this.loaded = true;
    }
    if (this.saved && !this.members.size && Date.now() - this.saved.created > ROOM_TTL) await this.drop();
    return this.saved;
  }

  private async persist(): Promise<void> {
    if (this.saved) await this.ctx.storage.put('room', this.saved);
  }

  private async drop(): Promise<void> {
    this.saved = null;
    this.phase = 'lobby';
    await this.ctx.storage.deleteAll();
  }

  // ---------- RPC from the Hub ----------

  /** Claims this room code for a new room. False if the code is already in use. */
  async init(code: string, hostId: number, settings: RoomSettings): Promise<boolean> {
    if (await this.load()) return false;
    this.saved = { code, hostId, settings, allowed: [hostId], created: Date.now() };
    await this.persist();
    return true;
  }

  /** Lets `userId` join, if the inviter is in this room. */
  async allow(inviterId: number, userId: number): Promise<boolean> {
    const s = await this.load();
    if (!s || !this.members.has(inviterId)) return false;
    if (!s.allowed.includes(userId)) s.allowed.push(userId);
    await this.persist();
    return true;
  }

  // ---------- sockets ----------

  async fetch(request: Request): Promise<Response> {
    const s = await this.load();
    if (!s) return error(404, 'no_room', '없어진 방이에요');
    const id = Number(request.headers.get('x-uid'));
    const nickname = request.headers.get('x-nick') ?? '';
    const existing = this.members.get(id);
    if (!s.allowed.includes(id)) return error(403, 'not_invited', '초대받은 방에만 들어갈 수 있어요');
    if (!existing && this.phase === 'race') return error(409, 'racing', '지금 레이스 중이에요. 끝나면 다시 들어와 주세요');
    if (!existing && this.members.size >= s.settings.maxPlayers) return error(409, 'full', '방이 꽉 찼어요');

    const pair = new WebSocketPair();
    const ws = pair[1];
    ws.accept();
    if (existing?.ws) existing.ws.close(4000, 'replaced');
    const m: Member = existing ?? { id, nickname, cat: 0, accessory: 'none', ready: false, ws: null, budget: 0 };
    m.ws = ws;
    this.members.set(id, m);
    ws.addEventListener('message', (e) => this.onMessage(m, ws, e.data));
    ws.addEventListener('close', () => this.onClose(m, ws));
    ws.addEventListener('error', () => this.onClose(m, ws));
    this.send(ws, { type: 'welcome', you: id, code: s.code });
    this.broadcastState();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private onMessage(m: Member, ws: WebSocket, data: unknown): void {
    if (typeof data !== 'string' || data.length > 4096 || m.ws !== ws) return;
    // Flood guard: about 40 messages a second is plenty (20 Hz state + events).
    const sec = Math.floor(Date.now() / 1000);
    if ((m.budget >> 8) !== sec) m.budget = sec << 8;
    if ((m.budget & 0xff) >= 60) return;
    m.budget++;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    const s = this.saved;
    if (!s) return;
    const isHost = m.id === s.hostId;

    if (RELAY.has(msg.type as string)) {
      if (this.phase !== 'race') return;
      if (msg.type === 'ai' && !isHost) return; // only the host drives the computer cats
      msg.from = m.id;
      this.broadcast(msg, m.id);
      return;
    }

    switch (msg.type) {
      case 'settings':
        if (!isHost || this.phase !== 'lobby') return;
        s.settings = cleanSettings(msg.settings as Partial<RoomSettings>, s.settings);
        s.settings.maxPlayers = Math.max(s.settings.maxPlayers, this.members.size);
        void this.persist();
        break;
      case 'pick':
        if (this.phase !== 'lobby') return;
        if (typeof msg.cat === 'number' && msg.cat >= 0 && msg.cat < ROSTER_SIZE) m.cat = Math.floor(msg.cat);
        if (typeof msg.accessory === 'string' && /^[a-z]{1,16}$/.test(msg.accessory)) m.accessory = msg.accessory;
        break;
      case 'ready':
        if (this.phase !== 'lobby') return;
        m.ready = !!msg.ready;
        break;
      case 'start': {
        if (!isHost || this.phase !== 'lobby') return;
        const humans = [...this.members.values()];
        if (humans.some((h) => h.id !== s.hostId && !h.ready)) return this.send(ws, { type: 'error', message: '모두 준비 완료해야 시작할 수 있어요' });
        if (humans.length < 2 && !s.settings.fillAI) return this.send(ws, { type: 'error', message: '친구가 들어오거나 컴퓨터 채우기를 켜 주세요' });
        this.startRace(humans);
        return;
      }
      case 'lobby':
        // The host brings everyone back after the results.
        if (!isHost || this.phase !== 'race') return;
        this.phase = 'lobby';
        for (const h of this.members.values()) h.ready = false;
        for (const [id, h] of this.members) if (!h.ws) this.members.delete(id);
        this.broadcast({ type: 'lobby' });
        break;
      case 'kick': {
        if (!isHost || this.phase !== 'lobby' || msg.id === m.id) return;
        const target = this.members.get(Number(msg.id));
        if (!target) return;
        s.allowed = s.allowed.filter((a) => a !== target.id);
        void this.persist();
        this.send(target.ws, { type: 'kicked' });
        target.ws?.close(4003, 'kicked');
        this.members.delete(target.id);
        break;
      }
      case 'ping':
        return this.send(ws, { type: 'pong', t: msg.t });
      default:
        return;
    }
    this.broadcastState();
  }

  private startRace(humans: Member[]): void {
    const s = this.saved!;
    // Host first, then everyone else in the order they joined.
    humans.sort((a, b) => (a.id === s.hostId ? -1 : b.id === s.hostId ? 1 : 0));
    const slots: Slot[] = humans.map((h) => ({ kind: 'human', id: h.id, nickname: h.nickname, cat: h.cat, accessory: h.accessory }));
    if (s.settings.fillAI) {
      // Computer cats: cats nobody picked first, then repeats.
      const free = [...Array(ROSTER_SIZE).keys()].filter((c) => !humans.some((h) => h.cat === c));
      for (let i = 0; slots.length < GRID; i++) slots.push({ kind: 'ai', cat: free.length ? free[i % free.length] : i % ROSTER_SIZE });
    }
    this.phase = 'race';
    this.broadcast({
      type: 'start',
      hostId: s.hostId,
      track: s.settings.track,
      difficulty: s.settings.difficulty,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
      slots,
    });
  }

  private onClose(m: Member, ws: WebSocket): void {
    if (m.ws !== ws) return; // replaced by a newer connection
    m.ws = null;
    const s = this.saved;
    if (!s) return;
    if (this.phase === 'lobby') this.members.delete(m.id);
    else this.broadcast({ type: 'left', id: m.id });
    const connected = [...this.members.values()].filter((x) => x.ws);
    if (!connected.length) {
      this.members.clear();
      void this.drop();
      return;
    }
    if (m.id === s.hostId) {
      // Hand the room to the next player. Mid-race the new host can't take over the
      // computer cats seamlessly, so everyone goes back to the lobby.
      s.hostId = connected[0].id;
      void this.persist();
      if (this.phase === 'race') {
        this.phase = 'lobby';
        for (const [id, x] of this.members) if (!x.ws) this.members.delete(id);
        for (const x of this.members.values()) x.ready = false;
        this.broadcast({ type: 'lobby', reason: 'host_left' });
      }
    }
    this.broadcastState();
  }

  private state() {
    const s = this.saved!;
    return {
      type: 'state',
      code: s.code,
      hostId: s.hostId,
      phase: this.phase,
      settings: s.settings,
      members: [...this.members.values()].map((m) => ({
        id: m.id,
        nickname: m.nickname,
        cat: m.cat,
        accessory: m.accessory,
        ready: m.ready,
        connected: !!m.ws,
      })),
    };
  }

  private broadcastState(): void {
    if (this.saved) this.broadcast(this.state());
  }

  private send(ws: WebSocket | null, msg: unknown): void {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }

  private broadcast(msg: unknown, except?: number): void {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) {
      if (m.id === except || !m.ws) continue;
      try {
        m.ws.send(data);
      } catch {
        /* closed */
      }
    }
  }
}
