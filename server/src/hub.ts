import { DurableObject } from 'cloudflare:workers';
import { cleanSettings, error, json, type Env, type RoomSettings, type UserInfo } from './shared';

const SESSION_DAYS = 60;
const PBKDF2_ITERATIONS = 100_000;
const LOGIN_RE = /^[a-z0-9_]{4,20}$/;
/** 3–12 characters: English letters, Korean syllables and digits, with at least one letter. */
const NICK_RE = /^[A-Za-z0-9가-힣]{3,12}$/;
const NICK_LETTER_RE = /[A-Za-z가-힣]/;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type Relation = 'friend' | 'sent' | 'received';

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS }, key, 256);
  return hex(bits);
}

/** Constant-time string comparison (for password hashes). */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * The one shared instance behind accounts, nicknames, friendships, online presence and
 * invites. Data lives in this object's SQLite database.
 */
export class Hub extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Failed logins per login id: count and lock-out time (in memory; resets on restart). */
  private failures = new Map<string, { n: number; until: number }>();
  private signups = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        login TEXT NOT NULL UNIQUE,
        pass TEXT NOT NULL,
        salt TEXT NOT NULL,
        nickname TEXT,
        nick_key TEXT UNIQUE,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS friends (
        user_id INTEGER NOT NULL,
        other_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (user_id, other_id)
      );
    `);
  }

  // ---------- RPC from the worker ----------

  /** Who owns this session token (null if invalid or expired). */
  async auth(token: string): Promise<UserInfo | null> {
    if (!token || token.length > 100) return null;
    const row = this.sql
      .exec<{ id: number; nickname: string | null; expires: number }>(
        'SELECT u.id, u.nickname, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
        token,
      )
      .toArray()[0];
    if (!row || row.expires < Date.now()) return null;
    return { id: row.id, nickname: row.nickname };
  }

  // ---------- HTTP ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/ws') return await this.presenceSocket(request, url);
      const body = request.method === 'POST' ? await this.readJson(request) : {};
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';

      switch (`${request.method} ${url.pathname}`) {
        case 'POST /api/signup':
          return await this.signup(body, ip);
        case 'POST /api/login':
          return await this.login(body);
      }

      // Everything else needs a session.
      const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
      const me = await this.auth(token);
      if (!me) return error(401, 'auth', '다시 로그인해 주세요');

      switch (`${request.method} ${url.pathname}`) {
        case 'GET /api/me':
          return json({ user: me });
        case 'POST /api/logout':
          this.sql.exec('DELETE FROM sessions WHERE token = ?', token);
          return json({ ok: true });
        case 'POST /api/nickname':
          return this.setNickname(me, body);
        case 'POST /api/account/delete':
          return await this.deleteAccount(me, body);
      }
      if (!me.nickname) return error(403, 'nickname', '닉네임을 먼저 정해 주세요');
      switch (`${request.method} ${url.pathname}`) {
        case 'GET /api/users/search':
          return this.search(me, url.searchParams.get('q') ?? '');
        case 'GET /api/friends':
          return this.friendList(me);
        case 'POST /api/friends/request':
          return this.friendRequest(me, body);
        case 'POST /api/friends/accept':
          return this.friendAccept(me, body);
        case 'POST /api/friends/remove':
          return this.friendRemove(me, body);
        case 'POST /api/rooms':
          return await this.createRoom(me, body);
        case 'POST /api/rooms/invite':
          return await this.invite(me, body);
      }
      return error(404, 'not_found', '없는 주소예요');
    } catch (e) {
      console.error(e);
      return error(500, 'server', '서버 오류가 났어요. 잠시 뒤에 다시 해 주세요');
    }
  }

  private async readJson(request: Request): Promise<Record<string, unknown>> {
    const text = await request.text();
    if (text.length > 4000) throw new Error('body too large');
    try {
      const v = JSON.parse(text || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }

  // ---------- accounts ----------

  private async signup(body: Record<string, unknown>, ip: string): Promise<Response> {
    const login = String(body.login ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!LOGIN_RE.test(login)) return error(400, 'login', '아이디는 영어 소문자 · 숫자 · _ 로 4~20자예요');
    if (password.length < 8 || password.length > 64) return error(400, 'password', '비밀번호는 8~64자로 정해 주세요');
    // Slow down mass sign-ups from one address: 10 per hour.
    const now = Date.now();
    const recent = (this.signups.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= 10) return error(429, 'rate', '잠시 뒤에 다시 시도해 주세요');
    if (this.sql.exec('SELECT 1 FROM users WHERE login = ?', login).toArray().length) return error(409, 'login_taken', '이미 쓰고 있는 아이디예요');
    const salt = randomHex(16);
    const pass = await hashPassword(password, salt);
    const id = this.sql
      .exec<{ id: number }>('INSERT INTO users (login, pass, salt, created) VALUES (?, ?, ?, ?) RETURNING id', login, pass, salt, now)
      .one().id;
    recent.push(now);
    this.signups.set(ip, recent);
    return json({ token: this.newSession(id), user: { id, nickname: null } });
  }

  private async login(body: Record<string, unknown>): Promise<Response> {
    const login = String(body.login ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const now = Date.now();
    const f = this.failures.get(login);
    if (f && f.until > now) return error(429, 'locked', `비밀번호를 여러 번 틀렸어요. ${Math.ceil((f.until - now) / 1000)}초 뒤에 다시 해 주세요`);
    const row = this.sql
      .exec<{ id: number; pass: string; salt: string; nickname: string | null }>('SELECT id, pass, salt, nickname FROM users WHERE login = ?', login)
      .toArray()[0];
    // Hash even when the login doesn't exist, so timing doesn't reveal which logins are taken.
    const hash = await hashPassword(password, row?.salt ?? 'no-such-user');
    if (!row || !same(hash, row.pass)) {
      const n = (f?.n ?? 0) + 1;
      this.failures.set(login, { n, until: n >= 5 ? now + 60_000 : 0 });
      return error(401, 'wrong', '아이디나 비밀번호가 맞지 않아요');
    }
    this.failures.delete(login);
    this.sql.exec('DELETE FROM sessions WHERE user_id = ? AND expires < ?', row.id, now);
    return json({ token: this.newSession(row.id), user: { id: row.id, nickname: row.nickname } });
  }

  private newSession(userId: number): string {
    const token = randomHex(32);
    this.sql.exec('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)', token, userId, Date.now() + SESSION_DAYS * 86_400_000);
    return token;
  }

  private setNickname(me: UserInfo, body: Record<string, unknown>): Response {
    const nickname = String(body.nickname ?? '').trim();
    if (!NICK_RE.test(nickname) || !NICK_LETTER_RE.test(nickname))
      return error(400, 'nickname_format', '닉네임은 영어 · 한글(숫자 가능)로 3~12자예요');
    const key = nickname.toLowerCase();
    const taken = this.sql.exec<{ id: number }>('SELECT id FROM users WHERE nick_key = ?', key).toArray()[0];
    if (taken && taken.id !== me.id) return error(409, 'nickname_taken', '이미 누가 쓰고 있는 닉네임이에요');
    this.sql.exec('UPDATE users SET nickname = ?, nick_key = ? WHERE id = ?', nickname, key, me.id);
    return json({ user: { id: me.id, nickname } });
  }

  private async deleteAccount(me: UserInfo, body: Record<string, unknown>): Promise<Response> {
    const row = this.sql.exec<{ pass: string; salt: string }>('SELECT pass, salt FROM users WHERE id = ?', me.id).one();
    if (!same(await hashPassword(String(body.password ?? ''), row.salt), row.pass)) return error(401, 'wrong', '비밀번호가 맞지 않아요');
    const friends = this.friendIds(me.id);
    this.sql.exec('DELETE FROM friends WHERE user_id = ? OR other_id = ?', me.id, me.id);
    this.sql.exec('DELETE FROM sessions WHERE user_id = ?', me.id);
    this.sql.exec('DELETE FROM users WHERE id = ?', me.id);
    for (const ws of this.ctx.getWebSockets(String(me.id))) ws.close(4001, 'account deleted');
    for (const f of friends) this.push(f, { type: 'friends' });
    return json({ ok: true });
  }

  // ---------- friends ----------

  private relation(me: number, other: number): Relation | null {
    return this.sql.exec<{ status: Relation }>('SELECT status FROM friends WHERE user_id = ? AND other_id = ?', me, other).toArray()[0]?.status ?? null;
  }

  private friendIds(me: number): number[] {
    return this.sql.exec<{ other_id: number }>("SELECT other_id FROM friends WHERE user_id = ? AND status = 'friend'", me).toArray().map((r) => r.other_id);
  }

  private search(me: UserInfo, q: string): Response {
    q = q.trim().toLowerCase();
    if (q.length < 1 || q.length > 12) return json({ users: [] });
    // Escape LIKE wildcards in the query.
    const pattern = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const rows = this.sql
      .exec<{ id: number; nickname: string }>(
        "SELECT id, nickname FROM users WHERE nick_key LIKE ? ESCAPE '\\' AND id != ? ORDER BY (nick_key = ?) DESC, length(nick_key) LIMIT 10",
        pattern,
        me.id,
        q,
      )
      .toArray();
    return json({ users: rows.map((r) => ({ id: r.id, nickname: r.nickname, relation: this.relation(me.id, r.id) })) });
  }

  private friendList(me: UserInfo): Response {
    const rows = this.sql
      .exec<{ id: number; nickname: string; status: Relation }>(
        'SELECT u.id, u.nickname, f.status FROM friends f JOIN users u ON u.id = f.other_id WHERE f.user_id = ? ORDER BY u.nick_key',
        me.id,
      )
      .toArray();
    const view = (r: (typeof rows)[number]) => ({ id: r.id, nickname: r.nickname, online: this.online(r.id) });
    return json({
      friends: rows.filter((r) => r.status === 'friend').map(view),
      received: rows.filter((r) => r.status === 'received').map(view),
      sent: rows.filter((r) => r.status === 'sent').map(view),
    });
  }

  private friendRequest(me: UserInfo, body: Record<string, unknown>): Response {
    const key = String(body.nickname ?? '').trim().toLowerCase();
    const other = this.sql.exec<{ id: number; nickname: string }>('SELECT id, nickname FROM users WHERE nick_key = ?', key).toArray()[0];
    if (!other) return error(404, 'no_user', '그런 닉네임은 없어요');
    if (other.id === me.id) return error(400, 'self', '나 자신은 친구로 추가할 수 없어요');
    const rel = this.relation(me.id, other.id);
    if (rel === 'friend') return error(409, 'already', '이미 친구예요');
    if (rel === 'sent') return error(409, 'pending', '이미 친구 요청을 보냈어요');
    if (rel === 'received') return this.friendAccept(me, { id: other.id }); // they asked first: just accept
    const pending = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM friends WHERE user_id = ? AND status = 'sent'", me.id).one().n;
    if (pending >= 50) return error(429, 'too_many', '보낸 요청이 너무 많아요');
    this.sql.exec("INSERT INTO friends (user_id, other_id, status) VALUES (?, ?, 'sent'), (?, ?, 'received')", me.id, other.id, other.id, me.id);
    this.push(other.id, { type: 'friend_request', from: me.nickname });
    return json({ ok: true, relation: 'sent' });
  }

  private friendAccept(me: UserInfo, body: Record<string, unknown>): Response {
    const other = Number(body.id);
    if (this.relation(me.id, other) !== 'received') return error(404, 'no_request', '받은 친구 요청이 없어요');
    this.sql.exec("UPDATE friends SET status = 'friend' WHERE (user_id = ? AND other_id = ?) OR (user_id = ? AND other_id = ?)", me.id, other, other, me.id);
    this.push(other, { type: 'friend_accepted', from: me.nickname });
    this.push(other, { type: 'friends' });
    return json({ ok: true, relation: 'friend' });
  }

  /** Unfriend, cancel a sent request or decline a received one. */
  private friendRemove(me: UserInfo, body: Record<string, unknown>): Response {
    const other = Number(body.id);
    this.sql.exec('DELETE FROM friends WHERE (user_id = ? AND other_id = ?) OR (user_id = ? AND other_id = ?)', me.id, other, other, me.id);
    this.push(other, { type: 'friends' });
    return json({ ok: true });
  }

  // ---------- rooms ----------

  private async createRoom(me: UserInfo, body: Record<string, unknown>): Promise<Response> {
    const settings: RoomSettings = cleanSettings(body.settings as Partial<RoomSettings>);
    for (let attempt = 0; attempt < 5; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) code += ROOM_CHARS[crypto.getRandomValues(new Uint8Array(1))[0] % ROOM_CHARS.length];
      const room = this.env.ROOMS.get(this.env.ROOMS.idFromName(code));
      if (await room.init(code, me.id, settings)) return json({ code });
    }
    return error(503, 'busy', '방을 만들 수 없어요. 다시 해 주세요');
  }

  private async invite(me: UserInfo, body: Record<string, unknown>): Promise<Response> {
    const code = String(body.code ?? '');
    const other = this.sql
      .exec<{ id: number; nickname: string }>('SELECT id, nickname FROM users WHERE nick_key = ?', String(body.nickname ?? '').trim().toLowerCase())
      .toArray()[0];
    if (!other) return error(404, 'no_user', '그런 닉네임은 없어요');
    if (this.relation(me.id, other.id) !== 'friend') return error(403, 'not_friend', '친구만 초대할 수 있어요');
    if (!this.online(other.id)) return error(409, 'offline', `${other.nickname}님은 지금 접속 중이 아니에요`);
    if (!/^[A-Z0-9]{6}$/.test(code)) return error(400, 'code', '방 코드가 이상해요');
    const room = this.env.ROOMS.get(this.env.ROOMS.idFromName(code));
    const ok = await room.allow(me.id, other.id);
    if (!ok) return error(403, 'not_in_room', '내가 들어가 있는 방에만 초대할 수 있어요');
    this.push(other.id, { type: 'invite', from: me.nickname, code });
    return json({ ok: true });
  }

  // ---------- presence ----------

  private online(id: number): boolean {
    return this.ctx.getWebSockets(String(id)).length > 0;
  }

  private push(userId: number, msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(String(userId))) {
      try {
        ws.send(data);
      } catch {
        /* closing */
      }
    }
  }

  private async presenceSocket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return error(426, 'upgrade', 'WebSocket only');
    const me = await this.auth(url.searchParams.get('token') ?? '');
    if (!me?.nickname) return error(401, 'auth', '다시 로그인해 주세요');
    const wasOnline = this.online(me.id);
    const pair = new WebSocketPair();
    // Hibernatable: the Hub can sleep while thousands of players just sit online.
    this.ctx.acceptWebSocket(pair[1], [String(me.id)]);
    if (!wasOnline) for (const f of this.friendIds(me.id)) this.push(f, { type: 'presence', id: me.id, online: true });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong');
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const id = Number(this.ctx.getTags(ws)[0]);
    // The closing socket can still be listed; count the others.
    const others = this.ctx.getWebSockets(String(id)).filter((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (!others.length && Number.isFinite(id)) for (const f of this.friendIds(id)) this.push(f, { type: 'presence', id, online: false });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}
