// 入口の Worker。ページは静的アセット（public/）が配り、/api/ だけがここに来る。
// ログインと名簿（/api/auth/・/api/spaces・/api/shares）は Durable Object `main` へ渡す。
// マップの API は、先に `main` で主と ?space= の領域への権限を確かめ（src/store.ts の access）、
// 結果を X-Mindmap-Access に付けて、その領域の Durable Object へ渡す。外から来た同じ名前のヘッダは上書きする。
import { sameOrigin } from './auth.ts';
import { ACCESS_HEADER, storeStub } from './store.ts';
export { MindmapStore } from './store.ts';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const main = storeStub(env, 'main');
    if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/spaces' || url.pathname === '/api/shares') return main.fetch(request);

    const a = await main.access(request.url, request.headers.get('Cookie') || '', request.headers.get('Authorization') || '',
      url.searchParams.get('space') || '');
    if ('error' in a) return Response.json({ error: a.error }, { status: a.status, headers: { 'Cache-Control': 'no-store' } });
    if (a.via === 'session' && !sameOrigin(request)) return Response.json({ error: '別のサイトからの書き込みは受けません' }, { status: 403 });
    const headers = new Headers(request.headers);
    headers.set(ACCESS_HEADER, JSON.stringify({ spaceId: a.spaceId, accountId: a.accountId, role: a.role }));
    return storeStub(env, { space: a.spaceId }).fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;
