// 日次 ToDo の入口。ページ（public/）は静的アセット、/api/ は人ごとの Durable Object（DailyStore）へ渡す。
// 日付のページ（/2026-11-27）は index.html を返し、どの日を開くかはページが URL から決める。
// ログインは Google（src/auth.ts）。/api/auth/ とセッションの確認は Durable Object `auth` が受け持つ。
import { authRequired } from './auth.ts';
export { DailyStore } from './store.ts';

const USER_HEADER = 'X-Daily-User';
const noStore = { 'Cache-Control': 'no-store' };

/** cookie で通るので、別のサイトからの書き込みは受けない。 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(request.url).origin;
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (/^\/\d{4}-\d{2}-\d{2}\/?$/.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL('/', url), request));
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const auth = env.STORE.get(env.STORE.idFromName('auth'));
    if (url.pathname.startsWith('/api/auth/')) {
      if (request.method !== 'GET' && !sameOrigin(request)) return Response.json({ error: '別のサイトからは受けません' }, { status: 403, headers: noStore });
      return auth.fetch(request);
    }
    let email = 'local';
    if (authRequired(request, env)) {
      const me = await (await auth.fetch(new Request(new URL('/api/auth/me', url), { headers: request.headers }))).json<{ email: string | null }>();
      if (!me.email) return Response.json({ error: 'ログインしていません' }, { status: 401, headers: noStore });
      email = me.email;
    }
    if (!sameOrigin(request)) return Response.json({ error: '別のサイトからの書き込みは受けません' }, { status: 403, headers: noStore });
    const headers = new Headers(request.headers);
    headers.set(USER_HEADER, email);
    const stub = env.STORE.get(env.STORE.idFromName(`user:${email}`));
    return stub.fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;
