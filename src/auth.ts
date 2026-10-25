// ログイン。Knowledge Box と同じ形で、ブラウザは Google の OpenID Connect（PKCE・state・nonce）でログインし、
// 署名を確かめた ID トークンのメールアドレスが ALLOWED_EMAILS にあればセッションを作る。セッションの cookie は
// 乱数で、Durable Object の SQLite にはそのハッシュだけを置く。CLI とエージェントは Authorization: Bearer に
// API_TOKEN（Worker の secret）を付ける。
// 手元（localhost）では、GOOGLE_CLIENT_ID が無ければ認証なしで通す。
const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const SESSION_COOKIE = 'mindmap_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

export type Who = { email: string; via: 'session' | 'token' | 'local' };

function clean(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function sha256(value: string): Promise<string> {
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
function randomToken(bytes: number): string { return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes))); }

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}
function cookie(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}
function allowedEmails(env: Env): Set<string> {
  return new Set(clean(env.ALLOWED_EMAILS).split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}
function googleConfigured(env: Env): boolean { return !!(clean(env.GOOGLE_CLIENT_ID) && clean(env.GOOGLE_CLIENT_SECRET)); }
function redirectUri(request: Request): string { return new URL('/api/auth/google/callback', request.url).toString(); }

/** 認証を求めるか。手元で Google の設定が無いときだけ求めない。 */
export function authRequired(request: Request, env: Env): boolean {
  return !(LOCAL_HOSTNAMES.has(new URL(request.url).hostname) && !clean(env.GOOGLE_CLIENT_ID));
}

/** cookie で認証したときに、別のサイトから送られた書き込みでないか。 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(request.url).origin;
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

export class Auth {
  sql: SqlStorage;
  env: Env;

  constructor(sql: SqlStorage, env: Env) {
    this.sql = sql; this.env = env;
    sql.exec('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    sql.exec(`CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL)`);
  }

  /** リクエストの主。認証できなければ null。 */
  async who(request: Request): Promise<Who | null> {
    if (!authRequired(request, this.env)) return { email: 'local', via: 'local' };
    const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/)?.[1];
    if (bearer) {
      const expected = clean(this.env.API_TOKEN);
      return expected && await sha256(bearer) === await sha256(expected) ? { email: 'api-token', via: 'token' } : null;
    }
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return null;
    const row = this.sql.exec<{ email: string }>('SELECT email FROM sessions WHERE hash = ? AND expires_at > ?', await sha256(token), Date.now()).toArray()[0];
    // 許可を外したアドレスのセッションは、残っていても通さない
    return row && allowedEmails(this.env).has(row.email) ? { email: row.email, via: 'session' } : null;
  }

  /** /api/auth/ の下を受ける。該当しなければ null。 */
  async route(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/api/auth/me': {
        const who = await this.who(request);
        return Response.json({ authenticated: !!who, email: who?.email ?? null, google: googleConfigured(this.env) },
          { headers: { 'Cache-Control': 'no-store' } });
      }
      case '/api/auth/google/start': return this.start(request);
      case '/api/auth/google/callback': return this.finish(request);
      case '/api/auth/logout': {
        if (request.method !== 'POST' || !sameOrigin(request)) return Response.json({ error: 'POST で同じサイトから送ってください' }, { status: 403 });
        const token = readCookie(request, SESSION_COOKIE);
        if (token) this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256(token));
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie(request, '', 0) } });
      }
    }
    return null;
  }

  async start(request: Request): Promise<Response> {
    if (!googleConfigured(this.env)) return Response.json({ error: 'Google ログインの設定がありません' }, { status: 503 });
    const state = randomToken(32), codeVerifier = randomToken(48), nonce = randomToken(32);
    const now = Date.now();
    this.sql.exec('DELETE FROM oauth_states WHERE expires_at <= ?', now);
    this.sql.exec('INSERT INTO oauth_states (hash, code_verifier, nonce, expires_at) VALUES (?, ?, ?, ?)',
      await sha256(state), codeVerifier, nonce, now + OAUTH_STATE_MAX_AGE_MS);
    const u = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    u.searchParams.set('client_id', clean(this.env.GOOGLE_CLIENT_ID));
    u.searchParams.set('redirect_uri', redirectUri(request));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid email');
    u.searchParams.set('state', state);
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('code_challenge', await sha256(codeVerifier));
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('prompt', 'select_account');
    return Response.redirect(u.toString(), 302);
  }

  async finish(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const back = (result: string, setCookie?: string) => {
      const target = new URL('/', url.origin);
      if (result) target.searchParams.set('auth', result);
      const headers: Record<string, string> = { Location: target.toString(), 'Cache-Control': 'no-store' };
      if (setCookie) headers['Set-Cookie'] = setCookie;
      return new Response(null, { status: 303, headers });
    };
    if (!googleConfigured(this.env)) return back('google_not_configured');
    const state = clean(url.searchParams.get('state')), code = clean(url.searchParams.get('code'));
    if (!state || !code || url.searchParams.get('error')) return back(clean(url.searchParams.get('error')) || 'google_cancelled');

    const stateHash = await sha256(state);
    const saved = this.sql.exec<{ code_verifier: string; nonce: string; expires_at: number }>(
      'SELECT code_verifier, nonce, expires_at FROM oauth_states WHERE hash = ?', stateHash).toArray()[0];
    this.sql.exec('DELETE FROM oauth_states WHERE hash = ?', stateHash);
    if (!saved || saved.expires_at <= Date.now()) return back('google_state_expired');

    let idToken: string;
    try {
      const r = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: clean(this.env.GOOGLE_CLIENT_ID), client_secret: clean(this.env.GOOGLE_CLIENT_SECRET),
          redirect_uri: redirectUri(request), grant_type: 'authorization_code', code_verifier: saved.code_verifier,
        }),
      });
      if (!r.ok) return back('google_token_exchange_failed');
      idToken = (await r.json<{ id_token: string }>()).id_token;
    } catch {
      return back('google_unavailable');
    }
    let email: string;
    try {
      email = await verifyGoogleIdToken(idToken, clean(this.env.GOOGLE_CLIENT_ID), saved.nonce);
    } catch {
      return back('google_identity_invalid');
    }
    if (!allowedEmails(this.env).has(email)) {
      console.log(`ログインを断った: ${email} は ALLOWED_EMAILS にない`);
      return back('not_allowed');
    }

    const token = randomToken(32);
    const now = Date.now();
    this.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', now);
    this.sql.exec('INSERT INTO sessions (hash, email, expires_at) VALUES (?, ?, ?)', await sha256(token), email, now + SESSION_MAX_AGE_SECONDS * 1000);
    return back('', cookie(request, token, SESSION_MAX_AGE_SECONDS));
  }
}

/** Google の ID トークンの署名と中身を確かめ、確認済みのメールアドレスを返す。 */
async function verifyGoogleIdToken(idToken: unknown, clientId: string, nonce: string): Promise<string> {
  if (typeof idToken !== 'string') throw new Error('missing_id_token');
  const [h, p, s] = idToken.split('.');
  if (!h || !p || !s) throw new Error('invalid_jwt');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('invalid_algorithm');
  const r = await fetch(GOOGLE_JWKS_ENDPOINT, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('jwks_unavailable');
  const { keys } = await r.json<{ keys: (JsonWebKey & { kid?: string })[] }>();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown_signing_key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`))) throw new Error('invalid_signature');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!(payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com')
    || !auds.includes(clientId) || Number(payload.exp) <= Date.now() / 1000
    || payload.nonce !== nonce || payload.email_verified !== true || !clean(payload.email)) throw new Error('invalid_claims');
  return clean(payload.email).toLowerCase();
}
