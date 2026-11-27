// 日次 ToDo の入口。ページ（public/）は静的アセット、/api/ は人ごとの Durable Object（DailyStore）へ渡す。
// 日付のページ（/2026-11-27）は index.html を返し、どの日を開くかはページが URL から決める。
//
// エージェント向けに /mcp（src/mcp.ts）を持つ。入口は OAuth（workers-oauth-provider、トークンは KV の OAUTH_KV）。
// - /authorize: 許可の画面。Cloudflare Access の内側なので、Access を通った本人だけが許可できる
// - /mcp・/token・/register・/.well-known/*: Access の外（バイパス）。/mcp は OAuth のトークンで本人を確かめる
import { OAuthProvider, AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import type { ConsentDescription, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { who } from './access.ts';
import { handleMcp } from './mcp.ts';
export { DailyStore } from './store.ts';

const USER_HEADER = 'X-Daily-User';
const noStore = { 'Cache-Control': 'no-store' };
type Props = { email: string };

function userStub(env: Env, email: string) { return env.STORE.get(env.STORE.idFromName(`user:${email}`)); }

/** その人の Durable Object へ、画面と同じ API を投げる関数。 */
function storeFor(env: Env, email: string, origin: string) {
  const stub = userStub(env, email);
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set(USER_HEADER, email);
    return stub.fetch(new Request(new URL(path, origin), { ...init, headers }));
  };
}

// ---------- 許可の画面（/authorize） ----------
const escape = (v: string) => v.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function consentPage(d: ConsentDescription, handle: string, email: string): string {
  const name = escape(d.clientName);
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} に日次 ToDo を許可しますか</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;max-width:520px;margin:48px auto;padding:0 16px;line-height:1.6;color:#1f2328}
button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #cfcbc2;background:#fff;cursor:pointer}button.ok{background:#2f6feb;color:#fff;border-color:#2f6feb}
.warn{color:#e4572e}.muted{color:#6b7280;font-size:13px}</style>
<h1 style="font-size:20px">${name} に、日次 ToDo の読み書きを許可しますか？</h1>
<p>${d.clientDomain ? `発行元: <strong>${escape(d.clientDomain)}</strong>` : 'このアプリは自分で登録したもので、名前は確かめられていません。'}<br>
トークンの送り先: <strong>${escape(d.redirectHost)}</strong></p>
${d.redirectIsLoopback ? '<p class="warn">送り先はこのコンピューターの中のアプリです。自分で今ログインを始めたときだけ許可してください。</p>' : ''}
<p class="muted">${escape(email)} として、ToDo とその日のマインドマップを読み書きできるようになります。</p>
<form method="post"><input type="hidden" name="handle" value="${escape(handle)}">
<button class="ok" name="decision" value="approve">許可する</button> <button name="decision" value="deny">やめる</button></form></html>`;
}

async function authorize(request: Request, env: Env & { OAUTH_PROVIDER: OAuthHelpers }): Promise<Response> {
  const w = await who(request, env);
  if ('error' in w) return new Response(w.error, { status: w.status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...noStore } });
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      const req = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(req);
      const consent = await oauth.beginConsent(req);
      consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(consentPage(details, consent.handle, w.email), { headers: consent.headers });
    }
    if (request.method === 'POST') {
      const form = await request.formData();
      const handle = String(form.get('handle') || '');
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request, userId: encodeURIComponent(w.email), metadata: {},
        scope: approved.request.scope, props: { email: w.email } satisfies Props,
      });
      approved.headers.set('Location', redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    return new Response(null, { status: 405 });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError || e instanceof CimdFetchError) {
      const message = e instanceof AuthorizationError ? e.description : 'このアプリを確かめられませんでした。';
      return new Response(escape(message || '許可の手続きに失敗しました。もう一度試してください。'), { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    throw e;
  }
}

// ---------- 画面と API（Access の内側） ----------
const app: ExportedHandler<Env & { OAUTH_PROVIDER: OAuthHelpers }> = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/authorize') return authorize(request, env);
    if (/^\/\d{4}-\d{2}-\d{2}\/?$/.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL('/', url), request));
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const w = await who(request, env);
    if ('error' in w) return Response.json({ error: w.error }, { status: w.status, headers: noStore });
    // cookie で通るので、別のサイトからの書き込みは受けない
    const origin = request.headers.get('Origin');
    if (request.method !== 'GET' && origin && origin !== url.origin) return Response.json({ error: '別のサイトからの書き込みは受けません' }, { status: 403 });
    const headers = new Headers(request.headers);
    headers.set(USER_HEADER, w.email);
    return userStub(env, w.email).fetch(new Request(request, { headers }));
  },
};

// ---------- エージェント（/mcp、OAuth のトークンで来る） ----------
const mcp = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: Props }): Promise<Response> {
    const email = ctx.props?.email;
    if (!email) return Response.json({ error: 'トークンに人が結び付いていません' }, { status: 401 });
    return handleMcp(request, storeFor(env, email, new URL(request.url).origin));
  },
};

export default new OAuthProvider<Env>({
  apiRoute: '/mcp',
  apiHandler: mcp as ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>['fetch']> },
  defaultHandler: app as ExportedHandler<Env>,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  // デプロイ先の /mcp。トークンはこの資源のためだけに出す
  resourceMetadata: {
    resource: 'https://daily-todo.tomoya-12.workers.dev/mcp',
    authorization_servers: ['https://daily-todo.tomoya-12.workers.dev'],
    resource_name: '日次 ToDo',
  },
  // 使っている間は切れない（最後に使ってから 60 日で切れる）
  refreshTokenIdleTTL: 60 * 86400,
});
