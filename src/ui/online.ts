import { Api, ApiError, Socket, type FriendLists, type RoomSettings, type SearchResult } from '../net/api';
import { ROSTER } from '../kart/catKart';
import { ACCESSORIES } from '../kart/accessories';
import { TRACKS } from '../world/trackDefs';
import { DIFFICULTIES } from './menus';

export interface Slot {
  kind: 'human' | 'ai';
  id?: number;
  nickname?: string;
  cat: number;
  accessory?: string;
}

export interface StartMessage {
  hostId: number;
  track: number;
  difficulty: number;
  seed: number;
  slots: Slot[];
}

interface Member {
  id: number;
  nickname: string;
  cat: number;
  accessory: string;
  ready: boolean;
  connected: boolean;
}

interface RoomState {
  code: string;
  hostId: number;
  phase: 'lobby' | 'race';
  settings: RoomSettings;
  members: Member[];
}

/** What the race needs to talk to the room. */
export interface RoomLink {
  readonly myId: number;
  readonly hostId: number;
  send(msg: Record<string, unknown>): void;
}

export interface OnlineHooks {
  /** The online screens opened (pause the title menu). */
  onOpen(): void;
  /** Back to the title screen. */
  onClose(): void;
  /** Show this cat and accessory behind the room panel. */
  onPreview(cat: number, accessory: string): void;
  /** The host started the race. */
  onRaceStart(start: StartMessage, link: RoomLink): void;
  /** Race traffic from the other players (st / ai / ev / fin / left). */
  onRaceMessage(msg: Record<string, unknown>): void;
  /** The room went back to the lobby (after the results, or the host left). */
  onBackToLobby(reason?: string): void;
  sound(kind: 'move' | 'select'): void;
}

type Screen = 'off' | 'setup' | 'auth' | 'nickname' | 'home' | 'room';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const NICK_RE = /^[A-Za-z0-9가-힣]{3,12}$/;
const PICK_KEY = 'catcart.online.pick';

/**
 * Online play: account screens, friends, the room lobby and live invites.
 * The race itself is run by main.ts through the hooks.
 */
export class Online {
  readonly api = new Api();
  private root: HTMLElement;
  private toasts: HTMLElement;
  private screen: Screen = 'off';
  private authTab: 'login' | 'signup' = 'login';
  private presence: Socket | null = null;
  private roomSocket: Socket | null = null;
  private room: RoomState | null = null;
  private lists: FriendLists = { friends: [], received: [], sent: [] };
  private results: SearchResult[] = [];
  private query = '';
  private busy = false;
  private message: { text: string; bad: boolean } | null = null;
  private pick = { cat: 0, accessory: 'none' };
  private racing = false;
  private searchTimer = 0;
  /** Screen currently drawn (to keep typed text when it redraws). */
  private drawn: Screen = 'off';

  constructor(private hooks: OnlineHooks) {
    this.root = document.createElement('div');
    this.root.id = 'online';
    document.body.appendChild(this.root);
    this.toasts = document.createElement('div');
    this.toasts.id = 'toasts';
    document.body.appendChild(this.toasts);
    try {
      const p = JSON.parse(localStorage.getItem(PICK_KEY) ?? 'null');
      if (p && Number.isInteger(p.cat)) this.pick = { cat: Math.min(p.cat, ROSTER.length - 1), accessory: String(p.accessory ?? 'none') };
    } catch {
      /* defaults */
    }
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (el && !el.hasAttribute('disabled')) void this.act(el.dataset.a!, el.dataset.v ?? '');
    });
    // Forms carry data-form (not data-a): tapping a text box inside must not submit it.
    this.root.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      void this.act(form.dataset.form!, '');
    });
    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'search') {
        this.query = t.value;
        clearTimeout(this.searchTimer);
        this.searchTimer = window.setTimeout(() => void this.runSearch(), 250);
      }
    });
    this.toasts.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
      if (!el) return;
      const toast = el.closest<HTMLElement>('.toast');
      toast?.remove();
      if (el.dataset.t === 'join') void this.joinRoom(el.dataset.v!);
    });
    // Signed in from an earlier visit: come online quietly so friends can invite us.
    if (this.api.configured && this.api.token && this.api.user?.nickname) this.connectPresence();
  }

  get isOpen(): boolean {
    return this.screen !== 'off';
  }

  get inRoom(): boolean {
    return !!this.roomSocket;
  }

  // ---------- open / close ----------

  async open(): Promise<void> {
    this.hooks.onOpen();
    this.message = null;
    if (!this.api.configured) return this.show('setup');
    if (!this.api.token) return this.show('auth');
    this.show('home');
    try {
      const me = await this.api.me();
      if (!me.nickname) return this.show('nickname');
      this.connectPresence();
      await this.refreshFriends();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.show('auth');
      else this.flash(e);
    }
  }

  /** Leaves the online screens (and the room) for the title screen. */
  close(): void {
    this.leaveRoom();
    this.show('off');
    this.hooks.onClose();
  }

  /** After a race: show the room lobby again. */
  showRoom(): void {
    this.racing = false;
    this.show('room');
  }

  /** Esc / back button. */
  back(): void {
    if (this.screen === 'room') return void this.act('leaveRoom', '');
    if (this.screen === 'nickname' && this.api.user?.nickname) return this.show('home');
    this.close();
  }

  private show(screen: Screen): void {
    this.screen = screen;
    document.body.classList.toggle('in-online', screen !== 'off');
    this.render();
  }

  // ---------- presence ----------

  private connectPresence(): void {
    if (this.presence || !this.api.token) return;
    this.presence = new Socket(() => `${this.api.wsBase}/ws?token=${this.api.token}`);
    this.presence.onMessage = (m) => this.onPresence(m);
    this.presence.onFatal = () => (this.presence = null);
  }

  private onPresence(m: Record<string, unknown>): void {
    switch (m.type) {
      case 'friend_request':
        this.toast(`💌 <b>${esc(String(m.from))}</b>님이 친구 요청을 보냈어요`);
        void this.refreshFriends();
        break;
      case 'friend_accepted':
        this.toast(`🤝 <b>${esc(String(m.from))}</b>님과 친구가 됐어요!`);
        void this.refreshFriends();
        break;
      case 'friends':
        void this.refreshFriends();
        break;
      case 'presence':
        for (const f of this.lists.friends) if (f.id === m.id) f.online = !!m.online;
        this.render();
        break;
      case 'invite':
        if (this.roomSocket) return; // already in a room
        this.toast(
          `🏁 <b>${esc(String(m.from))}</b>님이 레이스에 초대했어요!`,
          `<button data-t="join" data-v="${esc(String(m.code))}">참가하기</button><button data-t="no">거절</button>`,
          15000,
        );
        this.hooks.sound('select');
        break;
    }
  }

  private async refreshFriends(): Promise<void> {
    try {
      this.lists = await this.api.friends();
      if (this.query) await this.runSearch();
      this.render();
    } catch {
      /* shown elsewhere */
    }
  }

  private async runSearch(): Promise<void> {
    const q = this.query.trim();
    if (!q) {
      this.results = [];
      return this.render();
    }
    try {
      this.results = (await this.api.search(q)).users;
    } catch (e) {
      this.flash(e);
    }
    this.render();
  }

  // ---------- rooms ----------

  private async createRoom(): Promise<void> {
    const { code } = await this.api.createRoom({ maxPlayers: 4, fillAI: true, track: 0, difficulty: 1 });
    await this.joinRoom(code);
  }

  private async joinRoom(code: string): Promise<void> {
    if (this.roomSocket) this.leaveRoom();
    if (!this.isOpen) this.hooks.onOpen();
    this.room = null;
    this.show('room');
    const socket = new Socket(() => `${this.api.wsBase}/room/${code}?token=${this.api.token}`);
    this.roomSocket = socket;
    socket.onMessage = (m) => this.onRoom(m);
    socket.onFatal = (codeNum) => {
      if (this.roomSocket !== socket) return;
      this.roomSocket = null;
      this.room = null;
      const why = codeNum === 4003 ? '방장이 방에서 내보냈어요' : '방에 들어갈 수 없어요 (없어졌거나, 꽉 찼거나, 레이스 중이에요)';
      if (this.racing) this.hooks.onBackToLobby('closed');
      this.racing = false;
      this.message = { text: why, bad: true };
      this.show('home');
      void this.refreshFriends();
    };
    socket.onStatus = (ok) => {
      if (!ok && this.screen === 'room') {
        this.message = { text: '연결이 끊겼어요. 다시 연결하는 중…', bad: true };
        this.render();
      }
    };
  }

  private leaveRoom(): void {
    const s = this.roomSocket;
    this.roomSocket = null;
    this.room = null;
    s?.close();
    if (this.racing) this.hooks.onBackToLobby('left');
    this.racing = false;
  }

  private onRoom(m: Record<string, unknown>): void {
    switch (m.type) {
      case 'welcome':
        this.message = null;
        this.roomSocket?.send({ type: 'pick', cat: this.pick.cat, accessory: this.pick.accessory });
        this.hooks.onPreview(this.pick.cat, this.pick.accessory);
        break;
      case 'state':
        this.room = m as unknown as RoomState;
        if (!this.racing) this.render();
        break;
      case 'error':
        this.message = { text: String(m.message), bad: true };
        this.render();
        break;
      case 'kicked':
        break; // the close (4003) follows
      case 'start': {
        const start = m as unknown as StartMessage;
        const socket = this.roomSocket!;
        const myId = this.api.user!.id;
        this.racing = true;
        this.show('off');
        this.hooks.onRaceStart(start, { myId, hostId: start.hostId, send: (msg) => socket.send(msg) });
        break;
      }
      case 'lobby':
        if (this.racing) {
          this.racing = false;
          this.hooks.onBackToLobby(m.reason as string | undefined);
          if (m.reason === 'host_left') this.message = { text: '방장이 나가서 로비로 돌아왔어요', bad: true };
        }
        this.show('room');
        break;
      default:
        if (this.racing) this.hooks.onRaceMessage(m);
    }
  }

  /** Host: back to the lobby for everyone (from the results screen). */
  hostBackToLobby(): void {
    this.roomSocket?.send({ type: 'lobby' });
  }

  /** Leave the race and the room (from the race menu). */
  quitRoom(): void {
    this.leaveRoom();
    this.show('home');
    void this.refreshFriends();
  }

  get isHost(): boolean {
    return !!this.room && this.room.hostId === this.api.user?.id;
  }

  // ---------- actions ----------

  private val(name: string): string {
    return (this.root.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '').trim();
  }

  private async act(a: string, v: string): Promise<void> {
    if (this.busy) return;
    this.hooks.sound('select');
    const room = this.room;
    const host = this.isHost;
    const send = (msg: Record<string, unknown>) => this.roomSocket?.send(msg);
    const settings = (patch: Partial<RoomSettings>) => room && send({ type: 'settings', settings: { ...room.settings, ...patch } });
    try {
      switch (a) {
        case 'close':
          return this.close();
        case 'back':
          return this.back();
        case 'tab':
          this.authTab = v as 'login' | 'signup';
          this.message = null;
          return this.render();
        case 'auth': {
          const login = this.val('login');
          const password = this.val('password');
          if (this.authTab === 'signup' && password !== this.val('password2')) throw new Error('비밀번호 확인이 달라요');
          await this.withBusy(() => (this.authTab === 'signup' ? this.api.signup(login, password) : this.api.login(login, password)));
          this.message = null;
          if (!this.api.user?.nickname) return this.show('nickname');
          this.connectPresence();
          this.show('home');
          return this.refreshFriends();
        }
        case 'nickname': {
          const nick = this.val('nickname');
          if (!NICK_RE.test(nick) || !/[A-Za-z가-힣]/.test(nick)) throw new Error('닉네임은 영어 · 한글(숫자 가능)로 3~12자예요');
          await this.withBusy(() => this.api.setNickname(nick));
          this.message = { text: `반가워요, ${nick}님! 🐱`, bad: false };
          this.connectPresence();
          this.show('home');
          return this.refreshFriends();
        }
        case 'editNick':
          this.message = null;
          return this.show('nickname');
        case 'logout':
          this.presence?.close();
          this.presence = null;
          await this.api.logout().catch(() => {});
          this.lists = { friends: [], received: [], sent: [] };
          this.message = null;
          this.authTab = 'login';
          return this.show('auth');
        case 'deleteAccount': {
          const pw = prompt('정말 계정을 삭제할까요? 친구 목록도 모두 지워져요.\n확인하려면 비밀번호를 입력하세요.');
          if (!pw) return;
          await this.withBusy(() => this.api.deleteAccount(pw));
          this.presence?.close();
          this.presence = null;
          this.message = { text: '계정을 삭제했어요', bad: false };
          return this.show('auth');
        }
        case 'addFriend':
          await this.api.requestFriend(v);
          this.message = { text: `${v}님에게 친구 요청을 보냈어요`, bad: false };
          return this.refreshFriends();
        case 'accept':
          await this.api.acceptFriend(Number(v));
          return this.refreshFriends();
        case 'remove': {
          const f = [...this.lists.friends, ...this.lists.received, ...this.lists.sent].find((x) => x.id === Number(v));
          if (f && this.lists.friends.includes(f) && !confirm(`${f.nickname}님을 친구에서 삭제할까요?`)) return;
          await this.api.removeFriend(Number(v));
          return this.refreshFriends();
        }
        case 'createRoom':
          return this.withBusy(() => this.createRoom());
        case 'leaveRoom':
          this.leaveRoom();
          this.message = null;
          this.show('home');
          return this.refreshFriends();
        case 'invite': {
          if (!room) return;
          const nick = v || this.val('inviteNick');
          if (!nick) return;
          await this.api.invite(room.code, nick);
          this.message = { text: `${nick}님에게 초대를 보냈어요 💌`, bad: false };
          return this.render();
        }
        case 'cat':
        case 'acc': {
          const step = Number(v);
          if (a === 'cat') this.pick.cat = (this.pick.cat + step + ROSTER.length) % ROSTER.length;
          else {
            const i = ACCESSORIES.findIndex((x) => x.id === this.pick.accessory);
            this.pick.accessory = ACCESSORIES[(i + step + ACCESSORIES.length) % ACCESSORIES.length].id;
          }
          try {
            localStorage.setItem(PICK_KEY, JSON.stringify(this.pick));
          } catch {
            /* ignore */
          }
          this.hooks.onPreview(this.pick.cat, this.pick.accessory);
          return send({ type: 'pick', cat: this.pick.cat, accessory: this.pick.accessory });
        }
        case 'ready': {
          const me = room?.members.find((x) => x.id === this.api.user?.id);
          return send({ type: 'ready', ready: !me?.ready });
        }
        case 'start':
          return send({ type: 'start' });
        case 'kick':
          return send({ type: 'kick', id: Number(v) });
        case 'seats':
          if (host && room) settings({ maxPlayers: Math.max(room.members.length, Math.min(6, room.settings.maxPlayers + Number(v))) });
          return;
        case 'fillAI':
          if (host && room) settings({ fillAI: !room.settings.fillAI });
          return;
        case 'track':
          if (host && room) settings({ track: (room.settings.track + Number(v) + TRACKS.length) % TRACKS.length });
          return;
        case 'diff':
          if (host) settings({ difficulty: Number(v) });
          return;
      }
    } catch (e) {
      this.flash(e);
    }
  }

  private async withBusy<T>(fn: () => Promise<T>): Promise<T> {
    this.busy = true;
    this.render();
    try {
      return await fn();
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private flash(e: unknown): void {
    this.message = { text: e instanceof Error ? e.message : String(e), bad: true };
    this.render();
  }

  private toast(html: string, buttons = '', ms = 5000): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<div>${html}</div>${buttons ? `<div class="toast-btns">${buttons}</div>` : ''}`;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---------- rendering ----------

  private render(): void {
    const s = this.screen;
    this.root.className = s === 'off' ? '' : `show ${s}`;
    if (s === 'off') {
      this.root.innerHTML = '';
      this.drawn = 'off';
      return;
    }
    // Keep focus and caret in a text box across re-renders (search updates live).
    const active = document.activeElement as HTMLInputElement | null;
    const keep = active && this.root.contains(active) && active.name ? { name: active.name, pos: active.selectionStart } : null;
    // Redrawing the same screen keeps whatever was typed (friend lists refresh in the background).
    const typed = new Map<string, string>();
    if (s === this.drawn) for (const el of this.root.querySelectorAll<HTMLInputElement>('input[name]')) typed.set(el.name, el.value);
    this.drawn = s;
    const msg = this.message ? `<p class="ol-msg ${this.message.bad ? 'bad' : 'good'}">${esc(this.message.text)}</p>` : '';
    const top = `<button data-a="${s === 'room' ? 'leaveRoom' : 'back'}" class="back-btn">← ${s === 'room' ? '방 나가기' : '뒤로'}</button>`;
    this.root.innerHTML = `${top}<div class="ol-panel">${this.body(s)}${msg}</div>`;
    for (const [name, value] of typed) {
      const el = this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (el && value) el.value = value;
    }
    if (keep) {
      const el = this.root.querySelector<HTMLInputElement>(`[name="${keep.name}"]`);
      if (el) {
        el.focus();
        try {
          if (keep.pos !== null) el.setSelectionRange(keep.pos, keep.pos);
        } catch {
          /* some input types don't have a caret position */
        }
      }
    }
  }

  private body(s: Screen): string {
    const busy = this.busy ? 'disabled' : '';
    switch (s) {
      case 'setup':
        return `<h2>🌐 온라인 대전</h2>
          <p>아직 온라인 서버가 연결되지 않았어요.</p>
          <p class="ol-small">개발자용: <code>server/README.md</code> 를 보고 서버를 배포한 뒤 <code>VITE_SERVER_URL</code> 을 설정하세요.</p>`;
      case 'auth': {
        const signup = this.authTab === 'signup';
        return `<h2>🌐 온라인 대전</h2>
          <div class="ol-tabs">
            <button data-a="tab" data-v="login" class="${signup ? '' : 'on'}">로그인</button>
            <button data-a="tab" data-v="signup" class="${signup ? 'on' : ''}">회원가입</button>
          </div>
          <form data-form="auth" class="ol-form" autocomplete="on">
            <label>아이디<input name="login" id="ol-login" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="email" maxlength="20" placeholder="영어 소문자 · 숫자 · _ (4~20자)" /></label>
            <label>비밀번호<input name="password" id="ol-password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" maxlength="64" placeholder="8자 이상" /></label>
            ${signup ? '<label>비밀번호 확인<input name="password2" id="ol-password2" type="password" autocomplete="new-password" maxlength="64" /></label>' : ''}
            <button class="ol-go" ${busy}>${signup ? '가입하기' : '로그인'}</button>
          </form>`;
      }
      case 'nickname':
        return `<h2>닉네임 정하기</h2>
          <p>친구들이 나를 찾을 때 쓰는 이름이에요.</p>
          <form data-form="nickname" class="ol-form">
            <label>닉네임<input name="nickname" maxlength="12" value="${esc(this.api.user?.nickname ?? '')}" placeholder="예) 치즈냥, Kitty" autocomplete="off" /></label>
            <p class="ol-small">영어 · 한글 3~12자 (숫자 섞어도 돼요). 다른 사람과 같은 닉네임은 쓸 수 없어요.</p>
            <button class="ol-go" ${busy}>정하기</button>
          </form>`;
      case 'home':
        return this.homeBody(busy);
      case 'room':
        return this.roomBody();
      default:
        return '';
    }
  }

  private homeBody(busy: string): string {
    const L = this.lists;
    const rel = (r: SearchResult) =>
      r.relation === 'friend'
        ? '<span class="ol-tag">친구</span>'
        : r.relation === 'sent'
          ? '<span class="ol-tag">요청함</span>'
          : r.relation === 'received'
            ? `<button data-a="accept" data-v="${r.id}">수락</button>`
            : `<button data-a="addFriend" data-v="${esc(r.nickname)}">친구 추가</button>`;
    const results = this.query
      ? `<ul class="ol-list">${this.results.map((r) => `<li><span>${esc(r.nickname)}</span>${rel(r)}</li>`).join('') || '<li class="empty">찾는 닉네임이 없어요</li>'}</ul>`
      : '';
    const friends = L.friends.length
      ? L.friends
          .map(
            (f) =>
              `<li><span><i class="dot ${f.online ? 'on' : ''}"></i>${esc(f.nickname)}</span><small>${f.online ? '접속 중' : '오프라인'}</small><button class="x" data-a="remove" data-v="${f.id}" title="친구 삭제">✕</button></li>`,
          )
          .join('')
      : '<li class="empty">아직 친구가 없어요. 위에서 닉네임을 검색해 보세요!</li>';
    const received = L.received.length
      ? `<h3>💌 받은 친구 요청</h3><ul class="ol-list">${L.received
          .map((f) => `<li><span>${esc(f.nickname)}</span><button data-a="accept" data-v="${f.id}">수락</button><button class="x" data-a="remove" data-v="${f.id}">거절</button></li>`)
          .join('')}</ul>`
      : '';
    const sent = L.sent.length
      ? `<h3>보낸 요청</h3><ul class="ol-list">${L.sent.map((f) => `<li><span>${esc(f.nickname)}</span><small>기다리는 중</small><button class="x" data-a="remove" data-v="${f.id}">취소</button></li>`).join('')}</ul>`
      : '';
    return `<div class="ol-me">👤 <b>${esc(this.api.user?.nickname ?? '')}</b>
        <span><button data-a="editNick">닉네임 변경</button><button data-a="logout">로그아웃</button><button data-a="deleteAccount">계정 삭제</button></span></div>
      <button class="ol-go big" data-a="createRoom" ${busy}>🏁 방 만들기</button>
      <h3>🔍 친구 찾기</h3>
      <input name="search" class="ol-search" placeholder="닉네임으로 검색" value="${esc(this.query)}" autocomplete="off" maxlength="12" />
      ${results}
      ${received}
      <h3>🐾 친구 목록 (${L.friends.filter((f) => f.online).length}/${L.friends.length} 접속 중)</h3>
      <ul class="ol-list">${friends}</ul>
      ${sent}`;
  }

  private roomBody(): string {
    const r = this.room;
    if (!r) return '<h2>방에 들어가는 중…</h2>';
    const myId = this.api.user?.id;
    const host = r.hostId === myId;
    const st = r.settings;
    const me = r.members.find((m) => m.id === myId);
    const seats = r.members
      .map((m) => {
        const c = ROSTER[m.cat] ?? ROSTER[0];
        const acc = ACCESSORIES.find((a) => a.id === m.accessory);
        const kick = host && m.id !== myId ? `<button class="x" data-a="kick" data-v="${m.id}" title="내보내기">✕</button>` : '';
        const status = m.id === r.hostId ? '<span class="ol-tag host">👑 방장</span>' : m.ready ? '<span class="ol-tag ok">준비 완료</span>' : '<span class="ol-tag">준비 중</span>';
        return `<li class="${m.id === myId ? 'me' : ''}"><span><i class="cat" style="background:${hex(c.style.kart)}"></i>${esc(m.nickname)}</span><small>${c.name} ${acc && acc.id !== 'none' ? acc.icon : ''}</small>${status}${kick}</li>`;
      })
      .join('');
    const empty = Math.max(0, st.maxPlayers - r.members.length);
    // Seats nobody joined go to computer cats (or stay empty for friends-only races).
    const ai = st.fillAI ? empty : 0;
    const online = this.lists.friends.filter((f) => f.online && !r.members.some((m) => m.id === f.id));
    const inviteList = online.length
      ? online.map((f) => `<li><span><i class="dot on"></i>${esc(f.nickname)}</span><button data-a="invite" data-v="${esc(f.nickname)}">초대</button></li>`).join('')
      : '<li class="empty">지금 접속 중인 친구가 없어요</li>';
    const ctl = (attr: string) => (host ? attr : 'disabled');
    const allReady = r.members.every((m) => m.id === r.hostId || m.ready);
    const canStart = allReady && (r.members.length >= 2 || st.fillAI);
    const pickCat = ROSTER[this.pick.cat];
    const pickAcc = ACCESSORIES.find((a) => a.id === this.pick.accessory) ?? ACCESSORIES[0];
    return `<h2>🏁 레이스 방 <span class="ol-code">${esc(r.code)}</span></h2>
      <h3>참가자 (${r.members.length}/${st.maxPlayers})</h3>
      <ul class="ol-list seats">${seats}${(st.fillAI ? '<li class="empty">🤖 컴퓨터 고양이 (친구가 들어오면 바뀌어요)</li>' : '<li class="empty">빈 자리</li>').repeat(empty)}</ul>
      <p class="ol-small">${ai ? `🏁 친구 ${r.members.length}명 + 🤖 컴퓨터 ${ai}명, 모두 ${st.maxPlayers}대가 달려요` : `🏁 친구 ${r.members.length}명이 달려요`}</p>
      <div class="ol-grid">
        <div class="ol-set"><b>인원</b><span><button data-a="seats" data-v="-1" ${ctl('')}>−</button>${st.maxPlayers}명<button data-a="seats" data-v="1" ${ctl('')}>+</button></span></div>
        <div class="ol-set"><b>컴퓨터</b><span><button data-a="fillAI" class="${st.fillAI ? 'on' : ''}" ${ctl('')}>${st.fillAI ? '🤖 함께 달리기' : '👥 친구끼리만'}</button></span></div>
        <div class="ol-set"><b>트랙</b><span><button data-a="track" data-v="-1" ${ctl('')}>◀</button>${TRACKS[st.track].emoji} ${TRACKS[st.track].name}<button data-a="track" data-v="1" ${ctl('')}>▶</button></span></div>
        <div class="ol-set"><b>난이도</b><span>${DIFFICULTIES.map((d, i) => `<button data-a="diff" data-v="${i}" class="${st.difficulty === i ? 'on' : ''}" ${ctl('')}>${d.label}</button>`).join('')}</span></div>
        <div class="ol-set"><b>내 고양이</b><span><button data-a="cat" data-v="-1">◀</button><i class="cat" style="background:${hex(pickCat.style.kart)}"></i>${pickCat.name}<button data-a="cat" data-v="1">▶</button></span></div>
        <div class="ol-set"><b>액세서리</b><span><button data-a="acc" data-v="-1">◀</button>${pickAcc.icon} ${pickAcc.name}<button data-a="acc" data-v="1">▶</button></span></div>
      </div>
      <p class="ol-small">${pickCat.ability.icon} <b>${pickCat.ability.name}</b> · ${pickCat.ability.desc}</p>
      ${
        r.members.length < st.maxPlayers
          ? `<h3>💌 친구 초대</h3><ul class="ol-list">${inviteList}</ul>
             <form data-form="invite" class="ol-inline"><input name="inviteNick" placeholder="닉네임으로 초대" maxlength="12" autocomplete="off" /><button>초대</button></form>`
          : ''
      }
      ${
        host
          ? `<button class="ol-go big" data-a="start" ${canStart ? '' : 'disabled'}>🚦 레이스 시작!</button>
             ${!canStart ? `<p class="ol-small">${allReady ? '친구를 초대하거나 컴퓨터와 함께 달리기를 켜 주세요' : '모두 준비 완료를 누르면 시작할 수 있어요'}</p>` : ''}`
          : `<button class="ol-go big ${me?.ready ? 'on' : ''}" data-a="ready">${me?.ready ? '✅ 준비 완료! (취소하려면 누르기)' : '준비 완료'}</button>
             <p class="ol-small">방장이 시작하면 레이스가 시작돼요</p>`
      }`;
  }
}
