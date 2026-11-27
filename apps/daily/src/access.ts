// Cloudflare Access の JWT（Cf-Access-Jwt-Assertion か cookie の CF_Authorization）を確かめ、メールアドレスを返す。
// Access の前を通らずに Worker へ直接来たリクエスト（ヘッダの偽造）もここで弾く。
// 鍵は https://<team>.cloudflareaccess.com/cdn-cgi/access/certs から取り、1 時間覚えておく。

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let certs: { at: number; keys: Map<string, CryptoKey> } | null = null;

async function keys(team: string): Promise<Map<string, CryptoKey>> {
  if (certs && Date.now() - certs.at < 3600e3) return certs.keys;
  const r = await fetch(`${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`Access の鍵を読めませんでした（${r.status}）`);
  const body = await r.json() as { keys: Jwk[] };
  const map = new Map<string, CryptoKey>();
  for (const k of body.keys) {
    if (k.kty !== 'RSA') continue;
    map.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  certs = { at: Date.now(), keys: map };
  return map;
}

function b64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function token(request: Request): string | null {
  const h = request.headers.get('Cf-Access-Jwt-Assertion');
  if (h) return h;
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

export type Who = { email: string } | { status: number; error: string };

export async function who(request: Request, env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }): Promise<Who> {
  const url = new URL(request.url);
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    if (local) return { email: 'local' };
    return { status: 503, error: 'Cloudflare Access の設定（ACCESS_TEAM_DOMAIN・ACCESS_AUD）がまだです' };
  }
  const team = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, '');
  const jwt = token(request);
  if (!jwt) return { status: 401, error: 'ログインしていません（Cloudflare Access を通っていません）' };
  try {
    const [h, p, s] = jwt.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
    const key = (await keys(team)).get(header.kid);
    if (!key || header.alg !== 'RS256') throw new Error('鍵が合いません');
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) throw new Error('署名が合いません');
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) throw new Error('aud が合いません');
    if (payload.iss !== team) throw new Error('iss が合いません');
    const now = Date.now() / 1000;
    if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('期限切れです');
    if (typeof payload.email !== 'string' || !payload.email) throw new Error('メールアドレスがありません');
    return { email: payload.email.toLowerCase() };
  } catch (e) {
    return { status: 401, error: `ログインを確かめられませんでした: ${(e as Error).message}` };
  }
}
