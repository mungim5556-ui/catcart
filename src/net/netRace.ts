import * as THREE from 'three';
import type { Racer } from '../race/racer';
import type { ItemKind, Launch, HitItem } from '../items/items';
import type { RoomLink, Slot } from '../ui/online';

/** How often each game sends its karts (per second). */
const SEND_RATE = 20;
/** Remote karts are shown this far in the past, so there are snapshots on both sides. */
const DELAY_MS = 100;
/** Longest gap we bridge by extrapolating from the last velocity. */
const MAX_EXTRAPOLATE = 0.25;

interface Snap {
  at: number; // local receive time (ms)
  s: number[];
}

/** Something another player's game reported that this one has to act on. */
export type NetAction =
  | { kind: 'use'; owner: Racer; launch: Launch }
  | { kind: 'hit'; victim: Racer; by: Racer; item: HitItem; id?: string }
  | { kind: 'gone'; ids: string[] }
  | { kind: 'fin'; racer: Racer; time: number }
  | { kind: 'left'; racer: Racer };

const round = (v: number, d = 100) => Math.round(v * d) / d;

/**
 * One online race: which kart belongs to which slot, who decides what, and the
 * snapshots/events that keep everyone's games in step.
 *
 * Each player drives (and decides hits on) only their own kart; the host also drives the
 * computer cats. Everyone else's karts are shown from 20 Hz snapshots, smoothed by
 * rendering them 100 ms in the past.
 */
export class NetRace {
  readonly isHost: boolean;
  readonly localSlot: number;
  private bySlot: (Racer | undefined)[] = [];
  private slotOf = new Map<Racer, number>();
  private buffers = new Map<Racer, Snap[]>();
  private sendTimer = 0;
  private pending: NetAction[] = [];
  private gone = new Set<Racer>();

  constructor(
    private link: RoomLink,
    readonly slots: Slot[],
    racers: Racer[],
  ) {
    this.isHost = link.myId === link.hostId;
    this.localSlot = slots.findIndex((s) => s.kind === 'human' && s.id === link.myId);
    racers.forEach((r, i) => {
      this.bySlot[i] = r;
      this.slotOf.set(r, i);
    });
  }

  /** True if this game moves `r` itself (and decides item and obstacle hits on it). */
  drives(r: Racer): boolean {
    return r.control === 'local' || (r.control === 'ai' && this.isHost);
  }

  slot(r: Racer): number {
    return this.slotOf.get(r) ?? -1;
  }

  racer(slot: unknown): Racer | undefined {
    return typeof slot === 'number' ? this.bySlot[slot] : undefined;
  }

  // ---------- sending ----------

  /** Call every physics step: sends kart snapshots at SEND_RATE. */
  tick(dt: number, racers: Racer[]): void {
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.sendTimer += 1 / SEND_RATE;
    if (this.sendTimer < 0) this.sendTimer = 0;
    for (const r of racers) {
      if (r.control === 'local') this.link.send({ type: 'st', s: this.slot(r), k: this.encode(r) });
    }
    if (this.isHost) {
      const ai = racers.filter((r) => r.control === 'ai').map((r) => [this.slot(r), ...this.encode(r)]);
      if (ai.length) this.link.send({ type: 'ai', k: ai });
    }
  }

  sendLaunch(owner: Racer, l: Launch): void {
    this.link.send({
      type: 'ev',
      e: {
        k: 'use',
        s: this.slot(owner),
        item: l.item,
        id: l.id,
        p: [round(l.pos.x), round(l.pos.y), round(l.pos.z)],
        d: [round(l.dir.x, 1000), round(l.dir.z, 1000)],
        tg: l.target ? this.slot(l.target) : -1,
        v: l.victims.map((v) => this.slot(v)),
      },
    });
  }

  sendHit(victim: Racer, by: Racer, item: HitItem, id?: string): void {
    this.link.send({ type: 'ev', e: { k: 'hit', v: this.slot(victim), b: this.slot(by), item, id } });
  }

  sendGone(ids: string[]): void {
    if (ids.length) this.link.send({ type: 'ev', e: { k: 'gone', ids } });
  }

  sendFinish(r: Racer, time: number): void {
    this.link.send({ type: 'fin', s: this.slot(r), time: round(time, 1000) });
  }

  // ---------- receiving ----------

  /** Race traffic from the room. */
  receive(msg: Record<string, unknown>): void {
    const now = performance.now();
    switch (msg.type) {
      case 'st': {
        const r = this.racer(msg.s);
        if (r && !this.drives(r) && Array.isArray(msg.k)) this.push(r, now, msg.k as number[]);
        break;
      }
      case 'ai':
        if (this.isHost || !Array.isArray(msg.k)) break;
        for (const row of msg.k as number[][]) {
          const r = this.racer(row[0]);
          if (r && r.control === 'ai') this.push(r, now, row.slice(1));
        }
        break;
      case 'ev':
        this.event(msg.e as Record<string, unknown>);
        break;
      case 'fin': {
        const r = this.racer(msg.s);
        if (r && !this.drives(r) && typeof msg.time === 'number') this.pending.push({ kind: 'fin', racer: r, time: msg.time });
        break;
      }
      case 'left':
        for (const r of this.bySlot) {
          if (r && this.slots[this.slot(r)]?.id === msg.id && !this.gone.has(r)) {
            this.gone.add(r);
            this.pending.push({ kind: 'left', racer: r });
          }
        }
        break;
    }
  }

  private event(e: Record<string, unknown> | undefined): void {
    if (!e) return;
    if (e.k === 'use') {
      const owner = this.racer(e.s);
      const p = e.p as number[];
      const d = e.d as number[];
      if (!owner || !Array.isArray(p) || !Array.isArray(d)) return;
      this.pending.push({
        kind: 'use',
        owner,
        launch: {
          item: e.item as ItemKind,
          id: String(e.id),
          pos: new THREE.Vector3(p[0], p[1], p[2]),
          dir: new THREE.Vector3(d[0], 0, d[1]),
          target: this.racer(e.tg) ?? null,
          victims: Array.isArray(e.v) ? (e.v as number[]).map((s) => this.racer(s)).filter((r): r is Racer => !!r) : [],
        },
      });
    } else if (e.k === 'hit') {
      const victim = this.racer(e.v);
      const by = this.racer(e.b);
      if (victim && by) this.pending.push({ kind: 'hit', victim, by, item: e.item as HitItem, id: e.id as string | undefined });
    } else if (e.k === 'gone' && Array.isArray(e.ids)) {
      this.pending.push({ kind: 'gone', ids: (e.ids as unknown[]).map(String) });
    }
  }

  /** Everything received since the last call. */
  take(): NetAction[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  // ---------- snapshots ----------

  private encode(r: Racer): number[] {
    const k = r.physics;
    const flags = (k.drifting ? 1 : 0) | (k.grounded ? 2 : 0) | (k.offroad ? 4 : 0) | (k.driftDir > 0 ? 8 : 0) | (k.invulnTime > 0 ? 16 : 0);
    return [
      round(k.pos.x), round(k.pos.y), round(k.pos.z),
      round(k.vel.x), round(k.vel.y), round(k.vel.z),
      round(k.yaw, 1000),
      round(k.spinTime), round(k.starTime), round(k.shieldTime), round(k.slipTime), round(k.boostTime), round(k.trickTime),
      round(k.driftCharge), flags, round(r.lastInput.steer),
    ];
  }

  private push(r: Racer, at: number, s: number[]): void {
    if (s.length < 16 || s.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return;
    const buf = this.buffers.get(r) ?? [];
    buf.push({ at, s });
    while (buf.length > 12) buf.shift();
    this.buffers.set(r, buf);
  }

  /** Moves every kart this game doesn't drive to where its owner's game says it is. */
  applyRemote(racers: Racer[], dt: number): void {
    const t = performance.now() - DELAY_MS;
    for (const r of racers) {
      if (this.drives(r)) continue;
      const buf = this.buffers.get(r);
      if (!buf?.length) continue;
      let a = buf[0];
      let b = buf[0];
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].at <= t) a = buf[i];
        if (buf[i].at >= t) {
          b = buf[i];
          break;
        }
        b = buf[i];
      }
      const k = r.physics;
      const span = b.at - a.at;
      if (a !== b && span > 0) {
        const u = Math.min(1, Math.max(0, (t - a.at) / span));
        k.pos.set(a.s[0] + (b.s[0] - a.s[0]) * u, a.s[1] + (b.s[1] - a.s[1]) * u, a.s[2] + (b.s[2] - a.s[2]) * u);
        const dy = Math.atan2(Math.sin(b.s[6] - a.s[6]), Math.cos(b.s[6] - a.s[6]));
        k.yaw = a.s[6] + dy * u;
      } else {
        // Ran out of snapshots: carry on along the last velocity for a moment.
        const ahead = Math.min(MAX_EXTRAPOLATE, Math.max(0, (t - b.at) / 1000));
        k.pos.set(b.s[0] + b.s[3] * ahead, b.s[1] + b.s[4] * ahead, b.s[2] + b.s[5] * ahead);
        k.yaw = b.s[6];
      }
      const s = b.s;
      k.vel.set(s[3], s[4], s[5]);
      k.spinTime = s[7];
      k.starTime = s[8];
      k.shieldTime = s[9];
      k.slipTime = s[10];
      k.boostTime = s[11];
      k.trickTime = s[12];
      k.driftCharge = s[13];
      const f = s[14];
      k.drifting = !!(f & 1);
      k.grounded = !!(f & 2);
      k.offroad = !!(f & 4);
      k.driftDir = f & 8 ? 1 : -1;
      k.invulnTime = f & 16 ? Math.max(k.invulnTime - dt, 0.05) : 0;
      r.lastInput = { ...r.lastInput, steer: s[15] };
    }
  }
}
