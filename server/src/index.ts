import { CORS, error, type Env } from './shared';

export { Hub } from './hub';
export { Room } from './room';

/**
 * Routes:
 *   /api/...           accounts, nicknames, friends, rooms → the Hub (one instance for everyone)
 *   /ws?token=         presence socket (online status, friend requests, invites) → the Hub
 *   /room/CODE?token=  race room socket → that room's own Durable Object
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const hub = env.HUB.get(env.HUB.idFromName('hub'));

    if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return hub.fetch(request);

    const room = url.pathname.match(/^\/room\/([A-Z0-9]{6})$/);
    if (room) {
      if (request.headers.get('Upgrade') !== 'websocket') return error(426, 'upgrade', 'WebSocket only');
      const user = await hub.auth(url.searchParams.get('token') ?? '');
      if (!user?.nickname) return error(401, 'auth', '로그인이 필요해요');
      // Identity comes from the token, never from the client: overwrite anything they sent.
      const headers = new Headers(request.headers);
      headers.set('x-uid', String(user.id));
      headers.set('x-nick', user.nickname);
      return env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(new Request(request, { headers }));
    }

    if (url.pathname === '/') return new Response('CatCart server 🐱', { headers: CORS });
    return error(404, 'not_found', '없는 주소예요');
  },
} satisfies ExportedHandler<Env>;
