// End-to-end check against `npm run dev` (wrangler dev on :8787):
// sign up, nicknames, friends, presence, rooms, invites, ready/start and race relay.
const BASE = process.env.SERVER ?? 'http://localhost:8787';
const WS = BASE.replace(/^http/, 'ws');
let failed = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) failed++;
};
const api = async (path, body, token) => {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, ...(await res.json()) };
};
const socket = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    const waiters = [];
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data);
      const w = waiters.findIndex((x) => x.pred(m));
      if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
      else inbox.push(m);
    };
    ws.wait = (pred, ms = 3000) =>
      new Promise((res, rej) => {
        const i = inbox.findIndex(pred);
        if (i >= 0) return res(inbox.splice(i, 1)[0]);
        const t = setTimeout(() => rej(new Error('timeout waiting')), ms);
        waiters.push({ pred, resolve: (m) => (clearTimeout(t), res(m)) });
      });
    ws.sendJson = (m) => ws.send(JSON.stringify(m));
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });

const sfx = Math.random().toString(36).slice(2, 7);
const A = await api('/api/signup', { login: `alice_${sfx}`, password: 'password123' });
const B = await api('/api/signup', { login: `bob_${sfx}`, password: 'password456' });
ok(A.token && B.token, 'sign up two accounts');
ok((await api('/api/signup', { login: `alice_${sfx}`, password: 'password123' })).status === 409, 'duplicate login rejected');
ok((await api('/api/signup', { login: 'x', password: 'password123' })).status === 400, 'bad login rejected');
ok((await api('/api/login', { login: `alice_${sfx}`, password: 'nope-nope' })).status === 401, 'wrong password rejected');
const relog = await api('/api/login', { login: `ALICE_${sfx}`, password: 'password123' });
ok(relog.token && relog.user.nickname === null, 'log in (case-insensitive id), no nickname yet');

ok((await api('/api/friends', undefined, A.token)).status === 403, 'friends need a nickname first');
ok((await api('/api/nickname', { nickname: 'ab' }, A.token)).status === 400, 'nickname too short rejected');
ok((await api('/api/nickname', { nickname: '1234' }, A.token)).status === 400, 'digits-only nickname rejected');
ok((await api('/api/nickname', { nickname: 'ab cd' }, A.token)).status === 400, 'nickname with space rejected');
const nickA = `치즈${sfx.slice(0, 3)}`;
const nickB = `Bob${sfx}`;
ok((await api('/api/nickname', { nickname: nickA }, A.token)).user?.nickname === nickA, `Korean nickname set (${nickA})`);
ok((await api('/api/nickname', { nickname: nickB }, B.token)).user?.nickname === nickB, `English nickname set (${nickB})`);
ok((await api('/api/nickname', { nickname: nickB.toUpperCase() }, A.token)).status === 409, 'nickname taken (case-insensitive)');

const found = await api(`/api/users/search?q=${encodeURIComponent(nickB.slice(0, 4))}`, undefined, A.token);
ok(found.users?.some((u) => u.nickname === nickB), 'search finds the other player');

// Presence sockets
const presA = await socket(`${WS}/ws?token=${A.token}`);
const presB = await socket(`${WS}/ws?token=${B.token}`);
ok((await api('/api/friends/request', { nickname: nickB }, A.token)).relation === 'sent', 'friend request sent');
ok((await presB.wait((m) => m.type === 'friend_request')).from === nickA, 'B gets a live friend request');
const listB = await api('/api/friends', undefined, B.token);
ok(listB.received?.[0]?.nickname === nickA, 'B sees the request in the list');
ok((await api('/api/friends/accept', { id: listB.received[0].id }, B.token)).relation === 'friend', 'B accepts');
ok((await presA.wait((m) => m.type === 'friend_accepted')).from === nickB, 'A told the request was accepted');
const listA = await api('/api/friends', undefined, A.token);
ok(listA.friends?.[0]?.nickname === nickB && listA.friends[0].online, 'A sees B as an online friend');

// Rooms
const room = await api('/api/rooms', { settings: { maxPlayers: 3, fillAI: true, track: 2, difficulty: 1 } }, A.token);
ok(/^[A-Z0-9]{6}$/.test(room.code), `room created (${room.code})`);
const keptOut = await new Promise((res) => {
  const ws = new WebSocket(`${WS}/room/${room.code}?token=${B.token}`);
  ws.onopen = () => (ws.close(), res(false));
  ws.onerror = () => res(true);
});
ok(keptOut, 'uninvited player kept out');
const rA = await socket(`${WS}/room/${room.code}?token=${A.token}`);
ok((await rA.wait((m) => m.type === 'welcome')).you === A.user.id, 'host joins the room');
ok((await api('/api/rooms/invite', { code: room.code, nickname: nickB }, A.token)).ok, 'host invites B');
ok((await presB.wait((m) => m.type === 'invite')).code === room.code, 'B gets a live invite');
const rB = await socket(`${WS}/room/${room.code}?token=${B.token}`);
const st = await rB.wait((m) => m.type === 'state' && m.members.length === 2);
ok(st.settings.maxPlayers === 3 && st.hostId === A.user.id, 'B sees the room (2 players, host A)');

rB.sendJson({ type: 'settings', settings: { maxPlayers: 6 } });
rA.sendJson({ type: 'settings', settings: { fillAI: false, track: 4 } });
const st2 = await rB.wait((m) => m.type === 'state' && m.settings.track === 4);
ok(st2.settings.maxPlayers === 3 && st2.settings.fillAI === false, 'only the host changes settings');
rA.sendJson({ type: 'start' });
ok((await rA.wait((m) => m.type === 'error')).message.includes('준비'), 'cannot start until everyone is ready');
rB.sendJson({ type: 'pick', cat: 1, accessory: 'crown' });
rB.sendJson({ type: 'ready', ready: true });
await rA.wait((m) => m.type === 'state' && m.members.find((x) => x.id === B.user.id)?.ready);
rA.sendJson({ type: 'start' });
const start = await rB.wait((m) => m.type === 'start');
ok(start.slots.length === 2 && start.slots.every((s) => s.kind === 'human') && start.track === 4, 'race starts with 2 humans, no AI');
ok(start.slots[1].cat === 1 && start.slots[1].accessory === 'crown', 'picked cat and accessory carried over');

rB.sendJson({ type: 'st', p: [1, 2, 3] });
const relayed = await rA.wait((m) => m.type === 'st');
ok(relayed.from === B.user.id && relayed.p[2] === 3, 'kart state relayed to the other player');
rB.sendJson({ type: 'ai', k: [] });
await new Promise((r) => setTimeout(r, 300));
rA.sendJson({ type: 'lobby' });
ok((await rB.wait((m) => m.type === 'lobby')) && true, 'host returns everyone to the lobby');

// With AI fill
rA.sendJson({ type: 'settings', settings: { fillAI: true } });
rB.sendJson({ type: 'ready', ready: true });
await rA.wait((m) => m.type === 'state' && m.settings.fillAI && m.members.find((x) => x.id === B.user.id)?.ready);
rA.sendJson({ type: 'start' });
const start2 = await rB.wait((m) => m.type === 'start');
ok(start2.slots.length === 6 && start2.slots.filter((s) => s.kind === 'ai').length === 4, 'AI fill: 2 humans + 4 computer cats');
ok(!start2.slots.filter((s) => s.kind === 'ai').some((s) => s.cat === 1), 'computer cats avoid cats humans picked');

// Host leaves mid-race → B becomes host, back to lobby
rA.close();
const back = await rB.wait((m) => m.type === 'lobby');
ok(back.reason === 'host_left', 'host leaving mid-race sends everyone to the lobby');
ok((await rB.wait((m) => m.type === 'state' && m.hostId === B.user.id)) && true, 'B becomes the new host');

// Offline invites and deletion
presA.close();
await new Promise((r) => setTimeout(r, 300));
ok((await presB.wait((m) => m.type === 'presence' && m.online === false)).id === A.user.id, 'B sees A go offline');
ok((await api('/api/rooms/invite', { code: room.code, nickname: nickA }, B.token)).status === 409, 'cannot invite an offline friend');
ok((await api('/api/account/delete', { password: 'wrong-pass' }, A.token)).status === 401, 'account deletion needs the password');
ok((await api('/api/account/delete', { password: 'password123' }, A.token)).ok, 'account deleted');
ok((await api('/api/me', undefined, A.token)).status === 401, 'deleted account is logged out');
ok((await api('/api/friends', undefined, B.token)).friends.length === 0, 'friendship removed with the account');

rB.close();
presB.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed 🐱');
process.exit(failed ? 1 : 0);
