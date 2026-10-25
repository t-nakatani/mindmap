// 入口の Worker。ページは静的アセット（public/）が配り、/api/ だけがここに来る。
// /api/ はすべて、全マップを持つ Durable Object（1つだけ）へ渡す。ログインの確認も Durable Object で行う（src/auth.ts）。
export { MindmapStore } from './store.ts';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    return env.STORE.get(env.STORE.idFromName('main')).fetch(request);
  },
} satisfies ExportedHandler<Env>;
