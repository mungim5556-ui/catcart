/** Talks to the CatCart online server (see /server). */

export interface User {
  id: number;
  nickname: string | null;
}

export interface FriendView {
  id: number;
  nickname: string;
  online: boolean;
}

export interface FriendLists {
  friends: FriendView[];
  received: FriendView[];
  sent: FriendView[];
}

export interface SearchResult {
  id: number;
  nickname: string;
  relation: 'friend' | 'sent' | 'received' | null;
}

export interface RoomSettings {
  maxPlayers: number;
  fillAI: boolean;
  track: number;
  difficulty: number;
}

const SESSION_KEY = 'catcart.session.v1';
const SERVER_KEY = 'catcart.server';

/**
 * Server address: `?server=` (testing), then a saved override, then the build setting
 * (VITE_SERVER_URL). Empty means online play isn't set up yet.
 */
function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  try {
    if (q) localStorage.setItem(SERVER_KEY, q);
    return (q ?? localStorage.getItem(SERVER_KEY) ?? import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '');
  } catch {
    return (q ?? import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '');
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class Api {
  readonly base = serverUrl();
  token: string | null = null;
  user: User | null = null;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
      if (saved?.token) {
        this.token = saved.token;
        this.user = saved.user ?? null;
      }
    } catch {
      /* no saved session */
    }
  }

  get configured(): boolean {
    return !!this.base;
  }

  get wsBase(): string {
    return this.base.replace(/^http/, 'ws');
  }

  private save(): void {
    try {
      if (this.token) localStorage.setItem(SESSION_KEY, JSON.stringify({ token: this.token, user: this.user }));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* private mode */
    }
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'network', '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && data.error === 'auth') this.forget();
      throw new ApiError(res.status, data.error ?? 'error', data.message ?? '문제가 생겼어요');
    }
    return data as T;
  }

  private forget(): void {
    this.token = null;
    this.user = null;
    this.save();
  }

  private session(r: { token: string; user: User }): User {
    this.token = r.token;
    this.user = r.user;
    this.save();
    return r.user;
  }

  async signup(login: string, password: string): Promise<User> {
    return this.session(await this.call('/api/signup', { login, password }));
  }

  async login(login: string, password: string): Promise<User> {
    return this.session(await this.call('/api/login', { login, password }));
  }

  async logout(): Promise<void> {
    try {
      await this.call('/api/logout', {});
    } finally {
      this.forget();
    }
  }

  /** Checks the saved session is still valid. */
  async me(): Promise<User> {
    const r = await this.call<{ user: User }>('/api/me');
    this.user = r.user;
    this.save();
    return r.user;
  }

  async setNickname(nickname: string): Promise<User> {
    const r = await this.call<{ user: User }>('/api/nickname', { nickname });
    this.user = r.user;
    this.save();
    return r.user;
  }

  async deleteAccount(password: string): Promise<void> {
    await this.call('/api/account/delete', { password });
    this.forget();
  }

  search(q: string): Promise<{ users: SearchResult[] }> {
    return this.call(`/api/users/search?q=${encodeURIComponent(q)}`);
  }

  friends(): Promise<FriendLists> {
    return this.call('/api/friends');
  }

  requestFriend(nickname: string): Promise<{ relation: string }> {
    return this.call('/api/friends/request', { nickname });
  }

  acceptFriend(id: number): Promise<unknown> {
    return this.call('/api/friends/accept', { id });
  }

  removeFriend(id: number): Promise<unknown> {
    return this.call('/api/friends/remove', { id });
  }

  createRoom(settings: RoomSettings): Promise<{ code: string }> {
    return this.call('/api/rooms', { settings });
  }

  invite(code: string, nickname: string): Promise<unknown> {
    return this.call('/api/rooms/invite', { code, nickname });
  }
}

/**
 * A WebSocket that reconnects by itself and speaks JSON.
 * `onMessage` gets parsed messages; `onStatus` reports connected / disconnected.
 */
export class Socket {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private pinger = 0;
  private everOpened = false;
  onMessage: (msg: Record<string, unknown>) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};
  /** Close codes after which reconnecting is pointless (kicked, replaced, room gone…). */
  onFatal: (code: number, reason: string) => void = () => {};

  constructor(
    private url: () => string,
    private reconnect = true,
  ) {
    this.open();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private open(): void {
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.everOpened = true;
      this.retry = 0;
      this.onStatus(true);
      clearInterval(this.pinger);
      // Keeps proxies from dropping a quiet connection.
      this.pinger = window.setInterval(() => this.connected && ws.send('ping'), 25_000);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      try {
        this.onMessage(JSON.parse(e.data));
      } catch {
        /* ignore garbage */
      }
    };
    ws.onclose = (e) => {
      clearInterval(this.pinger);
      if (this.ws !== ws) return;
      this.onStatus(false);
      if (this.closed) return;
      // Never got in (not invited, room gone, logged out) or told to stay out: give up.
      if (e.code >= 4000 || !this.everOpened || !this.reconnect) {
        this.closed = true;
        this.onFatal(e.code, e.reason);
        return;
      }
      const wait = Math.min(15_000, 1000 * 2 ** this.retry++);
      setTimeout(() => !this.closed && this.open(), wait);
    };
  }

  send(msg: unknown): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    clearInterval(this.pinger);
    this.ws?.close();
  }
}
