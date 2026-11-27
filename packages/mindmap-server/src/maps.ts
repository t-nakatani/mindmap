// <mind-map> の保存側。使う側の Durable Object の中に置き、httpStore（packages/mindmap-element）が呼ぶ API を受ける。
// ログインと「誰のデータか」は使う側が決める（Durable Object を人ごとに分けるなど）。ここは1つの Durable Object の中のマップだけを扱う。
//
//   export class MyStore extends DurableObject {
//     maps = new MindmapMaps(this.ctx);
//     async fetch(req) {
//       const url = new URL(req.url);
//       if (url.pathname.startsWith('/api/mindmap/')) return this.maps.handle(req, url.pathname.slice('/api/mindmap'.length));
//       ...
//     }
//     webSocketMessage() {}  // ping には自動で pong を返す
//   }
//
// 受ける API（prefix からの相対）:
//   GET  /map?name=        マップの JSON と version。無ければ 404
//   PUT  /map?name=        {baseVersion, map}。版が古ければ 409 と {map, version}
//   GET  /maps             マップの一覧 {maps: [{name, title, version, updatedAt}]}
//   GET  /ws               WebSocket。書き込みのたびに {type: 'map', name, version, map} を流す
//   POST /op?name=         {op, args}。名前・ID・経路で指した操作を1つ当てる（mindmap-core の ops）
//   GET  /unfurl?url=      リンク先の題名など（1 週間覚えておく）
// 書き込みは同期の SQL だけで行い、途中で await しないので、読んでから書くまでに別の書き込みが割り込まない。
import { cleanName, normalize, isMap, roots, cleanUrl } from '../../mindmap-core/src/map.ts';
import type { MindMap } from '../../mindmap-core/src/map.ts';
import { applyOp as applyMapOp, OPS } from '../../mindmap-core/src/ops.ts';
import type { OpArgs } from '../../mindmap-core/src/ops.ts';
import { unfurl, privateHost } from './unfurl.ts';
import type { LinkMeta } from './unfurl.ts';

export interface MapSummary { name: string; title: string; version: number; updatedAt: string }
type Row = { name: string; data: string; version: number; title: string; updated_at: string };

export interface MindmapMapsOptions {
  /** 表の名前の頭。同じ Durable Object に別の表があってもぶつからないように。既定は mm_ */
  prefix?: string;
  /** 手元やネットワーク内のアドレスのリンクも読むか（手元の開発だけ true にする） */
  allowPrivateLinks?: boolean;
}

export class MindmapMaps {
  #ctx: DurableObjectState;
  #sql: SqlStorage;
  #t: { maps: string; links: string };
  #allowPrivate: boolean;

  constructor(ctx: DurableObjectState, opts: MindmapMapsOptions = {}) {
    this.#ctx = ctx;
    this.#sql = ctx.storage.sql;
    const p = opts.prefix ?? 'mm_';
    if (!/^[a-z_][a-z0-9_]*$/i.test(p)) throw new Error('prefix は英数字と _ だけ');
    this.#t = { maps: `${p}maps`, links: `${p}links` };
    this.#allowPrivate = !!opts.allowPrivateLinks;
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS ${this.#t.maps} (
      name TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS ${this.#t.links} (url TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL)`);
    // 画面が接続を保つために送る ping には、Durable Object を起こさずに pong を返す
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  read(name: string): { map: MindMap; version: number } | null {
    const r = this.#sql.exec<Row>(`SELECT * FROM ${this.#t.maps} WHERE name = ?`, name).toArray()[0];
    return r ? { map: normalize(JSON.parse(r.data)), version: r.version } : null;
  }
  list(): MapSummary[] {
    return this.#sql.exec<Row>(`SELECT name, title, version, updated_at FROM ${this.#t.maps} ORDER BY name`).toArray()
      .map(r => ({ name: r.name, title: r.title, version: r.version, updatedAt: r.updated_at }));
  }
  /** 書いて版を1つ上げ、つながっている画面に配る。新しい版を返す。 */
  write(name: string, map: MindMap, prevVersion: number): number {
    normalize(map);
    const version = prevVersion + 1;
    this.#sql.exec(`INSERT INTO ${this.#t.maps} (name, data, version, title, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET data = excluded.data, version = excluded.version, title = excluded.title, updated_at = excluded.updated_at`,
      name, JSON.stringify(map), version, roots(map).map(r => r.text).join(' / '), new Date().toISOString());
    this.broadcast({ type: 'map', name, version, map });
    return version;
  }
  /**
   * 名前・ID・経路で指した操作（add・move など。mindmap-core の ops）を1つ当てて書く。CLI・エージェント・MCP のツールから使う。
   * リンクの題名を読み込む操作は、呼ぶ側が先に args.titles を入れておく（入れなければドメインになる）。
   */
  op(name: string, op: string, args: OpArgs = {}): { version: number; message: string; id?: string } {
    if (!(OPS as readonly string[]).includes(op)) throw new HttpError(400, `知らない操作です: ${op}`);
    const cur = this.read(name);
    if (!cur && !(op === 'import' && args.replace)) throw new HttpError(404, `マップ「${name}」がありません`);
    const res = applyMapOp(cur?.map ?? null, op, args);
    const version = this.write(name, res.map ?? cur!.map, cur?.version ?? 0);
    return { version, message: res.message, id: res.id };
  }
  /** 中心ノードの文字の一覧（一覧に出す要約）。 */
  title(name: string): string {
    return this.#sql.exec<{ title: string }>(`SELECT title FROM ${this.#t.maps} WHERE name = ?`, name).toArray()[0]?.title ?? '';
  }

  broadcast(msg: unknown) {
    const text = JSON.stringify(msg);
    for (const ws of this.#ctx.getWebSockets('mindmap')) {
      try { ws.send(text); } catch { /* 切れた接続は close で片付く */ }
    }
  }

  async linkMeta(url: string): Promise<LinkMeta> {
    const row = this.#sql.exec<{ data: string; fetched_at: number }>(`SELECT data, fetched_at FROM ${this.#t.links} WHERE url = ?`, url).toArray()[0];
    if (row) {
      const meta = JSON.parse(row.data) as LinkMeta;
      if (Date.now() - row.fetched_at < (meta.ok ? 7 * 86400e3 : 3600e3)) return meta;
    }
    if (privateHost(url) && !this.#allowPrivate) throw new HttpError(400, `手元やネットワーク内のアドレスは読み込めません: ${url}`);
    const meta = await unfurl(url);
    this.#sql.exec(`INSERT INTO ${this.#t.links} (url, data, fetched_at) VALUES (?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`, url, JSON.stringify(meta), Date.now());
    return meta;
  }

  /**
   * API を受ける。path は prefix を除いた部分（/map など）。readOnly なら GET だけ受ける。
   * 該当しなければ 404 を返す。
   */
  async handle(request: Request, path: string, opts: { readOnly?: boolean } = {}): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (path === '/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'WebSocket で接続してください' });
        const pair = new WebSocketPair();
        this.#ctx.acceptWebSocket(pair[1], ['mindmap']);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      if (opts.readOnly && request.method !== 'GET') return json(403, { error: '閲覧のみです' });
      if (path === '/unfurl' && request.method === 'GET') {
        const target = cleanUrl(url.searchParams.get('url'));
        if (!target) throw new HttpError(400, 'url（http か https）が必要です');
        return json(200, await this.linkMeta(target));
      }
      if (path === '/maps' && request.method === 'GET') return json(200, { maps: this.list() });
      if (path === '/op' && request.method === 'POST') {
        const name = cleanName(url.searchParams.get('name'));
        const body = await readJson(request);
        return json(200, { ok: true, name, ...this.op(name, String(body.op || ''), body.args || {}) });
      }
      if (path === '/map') {
        const name = cleanName(url.searchParams.get('name'));
        if (request.method === 'GET') {
          const got = this.read(name);
          if (!got) throw new HttpError(404, `マップ「${name}」がありません`);
          return json(200, { ...got.map, name, version: got.version });
        }
        if (request.method === 'PUT') {
          // 本文は先に読み切る。ここから先は await しない
          const body = await readJson(request);
          const map = body.map;
          if (!isMap(map)) throw new HttpError(400, '中心ノードを含む nodes が必要です');
          if (typeof body.baseVersion !== 'number') throw new HttpError(400, 'baseVersion（読み込んだときの版番号）が必要です');
          const cur = this.read(name);
          const curVersion = cur?.version ?? 0;
          if (body.baseVersion !== curVersion) {
            throw new HttpError(409, `マップ「${name}」は別の場所で更新されています（版 ${curVersion}）`, { name, version: curVersion, map: cur?.map ?? null });
          }
          return json(200, { ok: true, name, version: this.write(name, map, curVersion) });
        }
      }
      return json(404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message, ...e.body });
      return json(400, { error: String((e as Error).message || e) });
    }
  }
}

export class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status; this.body = body;
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function readJson(request: Request): Promise<Record<string, any>> {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, '本文が JSON ではありません'); }
}
