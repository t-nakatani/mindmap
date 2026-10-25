// 全マップと「今選んでいるマップ」を持つ Durable Object。インスタンスは1つ（名前 main）だけ使う。
// - GET  /api/maps            マップの一覧と、今選んでいる名前
// - POST /api/maps            新しいマップを作る       {name, title, select?, replace?}
// - PUT  /api/current         選ぶマップを変える       {name}
// - GET  /api/map[?name=]     マップの JSON と版番号（name を省くと今選んでいるもの）
// - PUT  /api/map[?name=]     マップを丸ごと置き換える {baseVersion, map}。版が古ければ 409 と最新を返す
// - POST /api/op[?name=]      名前・ID・経路で指した操作を当てる {op, args}
// - POST /api/import          ファイル時代のマップをまとめて入れる {maps: {名前: マップ}, current?, replace?}
// - GET  /api/ws              変更を WebSocket で流す（map / current / maps）
// 書き込みは同期の SQL だけで行い、途中で await しない。だから読んでから書くまでに別の書き込みが割り込まない。
import { DurableObject } from 'cloudflare:workers';
import { cleanName, normalize, newMap, isMap, roots } from '../lib/map.ts';
import type { MindMap } from '../lib/map.ts';
import { applyOp, OPS } from '../lib/ops.ts';
import type { OpArgs } from '../lib/ops.ts';

export interface MapInfo { name: string; title: string; roots: number; version: number; updatedAt: string }
type MapRow = { name: string; data: string; version: number; title: string; roots: number; updated_at: string };

class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status; this.body = body;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export class MindmapStore extends DurableObject<Env> {
  sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS maps (
      name TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL,
      title TEXT NOT NULL, roots INTEGER NOT NULL, updated_at TEXT NOT NULL)`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    // ブラウザが接続を保つために送る ping には、DO を起こさずに pong を返す
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ---------- 読み書き ----------

  row(name: string): MapRow | null {
    return this.sql.exec<MapRow>('SELECT * FROM maps WHERE name = ?', name).toArray()[0] ?? null;
  }
  read(name: string): { map: MindMap; version: number } | null {
    const r = this.row(name);
    return r ? { map: normalize(JSON.parse(r.data)), version: r.version } : null;
  }
  list(): MapInfo[] {
    return this.sql.exec<MapRow>('SELECT name, title, roots, version, updated_at FROM maps').toArray()
      .map(r => ({ name: r.name, title: r.title, roots: r.roots, version: r.version, updatedAt: r.updated_at }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }
  /** 書いて版を1つ上げ、つながっている画面に配る。新しい版を返す。 */
  write(name: string, map: MindMap, prevVersion: number): number {
    normalize(map);
    const version = prevVersion + 1;
    const rs = roots(map);
    this.sql.exec(`INSERT INTO maps (name, data, version, title, roots, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET data = excluded.data, version = excluded.version, title = excluded.title,
        roots = excluded.roots, updated_at = excluded.updated_at`,
      name, JSON.stringify(map), version, rs.map(r => r.text).join(' / '), rs.length, new Date().toISOString());
    this.broadcast({ type: 'map', name, version, map });
    this.broadcastMaps();
    return version;
  }

  /** 今選んでいるマップ名。未設定か消えていれば、map → 一覧の先頭 の順で決めて書き留める。無ければ null。 */
  current(): string | null {
    const n = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'current'").toArray()[0]?.value;
    if (n && this.row(n)) return n;
    const all = this.list();
    const pick = this.row('map') ? 'map' : (all[0]?.name ?? null);
    if (pick) this.setMeta('current', pick);
    return pick;
  }
  setMeta(key: string, value: string) {
    this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }
  setCurrent(name: string): string {
    const n = cleanName(name);
    if (!this.row(n)) throw new HttpError(404, `マップ「${n}」がありません。maps で一覧を見てください`);
    const before = this.current();
    this.setMeta('current', n);
    if (before !== n) this.broadcast({ type: 'current', name: n });
    return n;
  }
  /** マップが1つも無ければ「map」を作って選ぶ。 */
  ensureAny(): string {
    const cur = this.current();
    if (cur) return cur;
    this.write('map', newMap('中心テーマ'), 0);
    return this.setCurrent('map');
  }
  /** ?name= の名前。省けば今選んでいるもの。 */
  target(url: URL): string {
    const q = url.searchParams.get('name');
    return q ? cleanName(q) : this.ensureAny();
  }

  // ---------- 配信 ----------

  broadcast(msg: unknown) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(text); } catch { /* 切れた接続は close で片付く */ }
    }
  }
  broadcastMaps() { this.broadcast({ type: 'maps', current: this.current(), maps: this.list() }); }

  async webSocketMessage() { /* 画面からは ping しか来ない（自動で pong を返す） */ }
  async webSocketClose(ws: WebSocket, code: number) { try { ws.close(code, 'closed'); } catch { /* もう閉じている */ } }

  // ---------- HTTP ----------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'WebSocket で接続してください' });
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      // 本文は先に読み切る。ここから先は await しない
      const body = request.method === 'GET' ? {} : await readJson(request);
      return this.route(request.method, url, body);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message, ...e.body });
      return json(400, { error: String((e as Error).message || e) });
    }
  }

  route(method: string, url: URL, body: Record<string, any>): Response {
    const p = url.pathname;
    if (p === '/api/maps' && method === 'GET') {
      return json(200, { current: this.current(), maps: this.list() });
    }
    if (p === '/api/maps' && method === 'POST') {
      const name = cleanName(body.name);
      const prev = this.row(name);
      if (prev && !body.replace) throw new HttpError(409, `マップ「${name}」はもうあります。別の名前にするか、作り直すなら --replace を付けてください`);
      const map = newMap(String(body.title || name));
      const version = this.write(name, map, prev?.version ?? 0);
      if (body.select) this.setCurrent(name);
      return json(200, { ok: true, name, version, root: map.nodes[0], current: this.current() });
    }
    if (p === '/api/current' && method === 'PUT') {
      return json(200, { ok: true, name: this.setCurrent(body.name) });
    }
    if (p === '/api/map' && method === 'GET') {
      const name = this.target(url);
      const got = this.read(name);
      if (!got) throw new HttpError(404, `マップ「${name}」がありません。maps で一覧を見るか、new <題名> --map ${name} で作ってください`);
      return json(200, { ...got.map, name, version: got.version });
    }
    if (p === '/api/map' && method === 'PUT') {
      const name = this.target(url);
      const map = body.map;
      if (!isMap(map)) throw new HttpError(400, '中心ノードを含む nodes が必要です');
      if (typeof body.baseVersion !== 'number') throw new HttpError(400, 'baseVersion（読み込んだときの版番号）が必要です');
      const cur = this.read(name);
      const curVersion = cur?.version ?? 0;
      if (body.baseVersion !== curVersion) {
        throw new HttpError(409, `マップ「${name}」は別の場所で更新されています（版 ${curVersion}）`, { name, version: curVersion, map: cur?.map ?? null });
      }
      const version = this.write(name, map, curVersion);
      return json(200, { ok: true, name, version });
    }
    if (p === '/api/op' && method === 'POST') {
      const name = this.target(url);
      const op = String(body.op || '');
      if (!(OPS as readonly string[]).includes(op)) throw new HttpError(400, `知らない操作です: ${op}`);
      const args: OpArgs = body.args || {};
      const cur = this.read(name);
      if (!cur && !(op === 'import' && args.replace)) {
        throw new HttpError(404, `マップ「${name}」がありません。maps で一覧を見るか、new <題名> --map ${name} で作ってください`);
      }
      const res = applyOp(cur?.map ?? null, op, args);
      const map = res.map ?? cur!.map;
      const version = this.write(name, map, cur?.version ?? 0);
      return json(200, { ok: true, name, version, message: res.message, id: res.id });
    }
    if (p === '/api/import' && method === 'POST') {
      const maps = body.maps;
      if (!maps || typeof maps !== 'object') throw new HttpError(400, 'maps（名前 → マップ）が必要です');
      const hadCurrent = !!this.current();
      const added: string[] = [], replaced: string[] = [], skipped: string[] = [];
      for (const [raw, map] of Object.entries(maps)) {
        const name = cleanName(raw);
        if (!isMap(map)) throw new HttpError(400, `マップ「${name}」の形が正しくありません`);
        const prev = this.row(name);
        if (prev && !body.replace) { skipped.push(name); continue; }
        this.write(name, map, prev?.version ?? 0);
        (prev ? replaced : added).push(name);
      }
      if (body.current && this.row(cleanName(body.current)) && (body.replace || !hadCurrent)) this.setCurrent(body.current);
      return json(200, { ok: true, added, replaced, skipped, current: this.current() });
    }
    throw new HttpError(404, 'not found');
  }
}

async function readJson(request: Request): Promise<Record<string, any>> {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, '本文が JSON ではありません'); }
}
