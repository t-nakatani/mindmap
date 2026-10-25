// 入口の Worker。ページは静的アセット（public/）が配り、/api/ だけがここに来る。
// /api/ は認証を確かめてから、全マップを持つ Durable Object（1つだけ）へ渡す。
//
// 認証は Cloudflare Access に任せる。ブラウザは本人のメールアドレスでログインし、CLI とエージェントは
// サービストークン（CF-Access-Client-Id / CF-Access-Client-Secret）を付ける。どちらでも Access が
// Cf-Access-Jwt-Assertion に署名つきの JWT を付けて渡すので、ここではその JWT を確かめる。
// ACCESS_TEAM_DOMAIN と ACCESS_AUD が空なら、手元（localhost）からだけ認証なしで通す。
export { MindmapStore } from './store.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const denied = await checkAccess(request, env, url);
    if (denied) return denied;
    return env.STORE.get(env.STORE.idFromName('main')).fetch(request);
  },
} satisfies ExportedHandler<Env>;

function deny(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

async function checkAccess(request: Request, env: Env, url: URL): Promise<Response | null> {
  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!team || !env.ACCESS_AUD) {
    return LOCAL_HOSTS.has(url.hostname) ? null : deny(403, 'Cloudflare Access の設定（ACCESS_TEAM_DOMAIN・ACCESS_AUD）がありません');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
  if (!token) return deny(401, 'Cloudflare Access を通っていません');
  try {
    await verifyJwt(token, team, env.ACCESS_AUD);
    return null;
  } catch (e) {
    return deny(403, `Access のトークンが正しくありません: ${(e as Error).message}`);
  }
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

// ---------- Access の JWT の検証 ----------

type Jwk = JsonWebKey & { kid: string };
let certs: { team: string; keys: Jwk[]; at: number } | null = null;

async function accessKeys(team: string, force = false): Promise<Jwk[]> {
  if (!force && certs && certs.team === team && Date.now() - certs.at < 3600_000) return certs.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`公開鍵を取れません（${r.status}）`);
  const { keys } = await r.json<{ keys: Jwk[] }>();
  certs = { team, keys, at: Date.now() };
  return keys;
}

function b64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function verifyJwt(token: string, team: string, aud: string): Promise<void> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('形が違います');
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  if (header.alg !== 'RS256') throw new Error(`知らない署名方式です: ${header.alg}`);
  let jwk = (await accessKeys(team)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await accessKeys(team, true)).find(k => k.kid === header.kid); // 鍵が入れ替わった直後
  if (!jwk) throw new Error('署名の鍵が見つかりません');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('署名が合いません');
  const auds: string[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('別のアプリのトークンです');
  if (payload.iss !== `https://${team}`) throw new Error('発行元が違います');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) throw new Error('期限が切れています');
}
