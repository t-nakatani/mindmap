// 日次 ToDo の入口。ページ（public/）は静的アセット、/api/ は人ごとの Durable Object（DailyStore）へ渡す。
// 日付のページ（/2026-11-27）は index.html を返し、どの日を開くかはページが URL から決める。
import { who } from './access.ts';
export { DailyStore } from './store.ts';

const USER_HEADER = 'X-Daily-User';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (/^\/\d{4}-\d{2}-\d{2}\/?$/.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL('/', url), request));
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const w = await who(request, env);
    if ('error' in w) return Response.json({ error: w.error }, { status: w.status, headers: { 'Cache-Control': 'no-store' } });
    // cookie で通るので、別のサイトからの書き込みは受けない
    const origin = request.headers.get('Origin');
    if (request.method !== 'GET' && origin && origin !== url.origin) return Response.json({ error: '別のサイトからの書き込みは受けません' }, { status: 403 });
    const headers = new Headers(request.headers);
    headers.set(USER_HEADER, w.email);
    const stub = env.STORE.get(env.STORE.idFromName(`user:${w.email}`));
    return stub.fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;
