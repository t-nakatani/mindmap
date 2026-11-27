// 1人分の日次 ToDo とマップ。マップの保存と API は mindmap-server（packages/mindmap-server）に任せ、ここは ToDo だけを持つ。
//
// - /api/auth/...        ログイン（この DO の名前が auth のときだけ使う。src/auth.ts）
// - /api/mindmap/...     <mind-map> の保存（httpStore が呼ぶ）。マップ名は daily-2026-11-27
// - GET    /api/todos?day=&today=   その日の ToDo。day が today で初めて開いたときは、前に ToDo がある日の未完了を持ち越す
// - POST   /api/todos    {day, text}            末尾に足す
// - PATCH  /api/todos    {id, text?, done?}     直す
// - DELETE /api/todos    {id}                   消す
import { DurableObject } from 'cloudflare:workers';
import { MindmapMaps, HttpError, json, readJson } from '@t-nakatani/mindmap-server';
import { Auth } from './auth.ts';

export interface Todo { id: number; day: string; text: string; done: boolean; position: number; carriedFrom: string | null; carriedTo: string | null }
type Row = { id: number; day: string; text: string; done: number; position: number; carried_from: string | null; carried_to: string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function day(v: unknown): string {
  const s = String(v ?? '');
  if (!DAY.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) throw new HttpError(400, `日付は 2026-11-27 の形で書いてください: ${s}`);
  return s;
}
function text(v: unknown): string {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!s) throw new HttpError(400, 'ToDo の文字が空です');
  if (s.length > 500) throw new HttpError(400, 'ToDo は 500 文字までです');
  return s;
}
const toTodo = (r: Row): Todo => ({ id: r.id, day: r.day, text: r.text, done: !!r.done, position: r.position, carriedFrom: r.carried_from, carriedTo: r.carried_to });

export class DailyStore extends DurableObject<Env> {
  sql: SqlStorage;
  maps: MindmapMaps;
  #auth: Auth | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.maps = new MindmapMaps(ctx);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
      position REAL NOT NULL, carried_from TEXT, carried_to TEXT, created_at TEXT NOT NULL, done_at TEXT)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS todos_day ON todos (day, position)');
    // 持ち越しを済ませた日
    this.sql.exec('CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, opened_at TEXT NOT NULL)');
  }

  list(d: string): Todo[] {
    return this.sql.exec<Row>('SELECT * FROM todos WHERE day = ? ORDER BY position, id', d).toArray().map(toTodo);
  }
  /** 今日を初めて開いたとき、前に ToDo がある日の未完了を写す。写した元には行き先を書いておく。 */
  carryOver(d: string) {
    if (this.sql.exec('SELECT 1 FROM days WHERE day = ?', d).toArray().length) return;
    this.sql.exec('INSERT INTO days (day, opened_at) VALUES (?, ?)', d, new Date().toISOString());
    const prev = this.sql.exec<{ day: string }>('SELECT MAX(day) AS day FROM todos WHERE day < ?', d).toArray()[0]?.day;
    if (!prev) return;
    const open = this.sql.exec<Row>('SELECT * FROM todos WHERE day = ? AND done = 0 AND carried_to IS NULL ORDER BY position, id', prev).toArray();
    let pos = this.nextPosition(d);
    const now = new Date().toISOString();
    for (const r of open) {
      this.sql.exec('INSERT INTO todos (day, text, done, position, carried_from, created_at) VALUES (?, ?, 0, ?, ?, ?)', d, r.text, pos++, prev, now);
      this.sql.exec('UPDATE todos SET carried_to = ? WHERE id = ?', d, r.id);
    }
  }
  nextPosition(d: string): number {
    return (this.sql.exec<{ p: number | null }>('SELECT MAX(position) AS p FROM todos WHERE day = ?', d).toArray()[0]?.p ?? -1) + 1;
  }
  row(id: unknown): Row {
    const r = this.sql.exec<Row>('SELECT * FROM todos WHERE id = ?', Number(id)).toArray()[0];
    if (!r) throw new HttpError(404, `ToDo ${id} がありません`);
    return r;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p.startsWith('/api/auth/')) return (this.#auth ??= new Auth(this.sql, this.env)).route(request);
    if (p.startsWith('/api/mindmap/')) return this.maps.handle(request, p.slice('/api/mindmap'.length));
    try {
      if (p === '/api/todos') {
        if (request.method === 'GET') {
          const d = day(url.searchParams.get('day'));
          if (url.searchParams.get('today') === d) this.carryOver(d);
          return json(200, { day: d, todos: this.list(d) });
        }
        const body = await readJson(request);
        if (request.method === 'POST') {
          const d = day(body.day);
          this.sql.exec('INSERT INTO todos (day, text, done, position, created_at) VALUES (?, ?, 0, ?, ?)', d, text(body.text), this.nextPosition(d), new Date().toISOString());
          return json(200, { day: d, todos: this.list(d) });
        }
        if (request.method === 'PATCH') {
          const r = this.row(body.id);
          if (body.text !== undefined) this.sql.exec('UPDATE todos SET text = ? WHERE id = ?', text(body.text), r.id);
          if (body.done !== undefined) this.sql.exec('UPDATE todos SET done = ?, done_at = ? WHERE id = ?', body.done ? 1 : 0, body.done ? new Date().toISOString() : null, r.id);
          return json(200, { day: r.day, todos: this.list(r.day) });
        }
        if (request.method === 'DELETE') {
          const r = this.row(body.id);
          this.sql.exec('DELETE FROM todos WHERE id = ?', r.id);
          // 持ち越した先を消したら、元の行は「持ち越し前」に戻す
          if (r.carried_from) this.sql.exec('UPDATE todos SET carried_to = NULL WHERE day = ? AND text = ? AND carried_to = ?', r.carried_from, r.text, r.day);
          return json(200, { day: r.day, todos: this.list(r.day) });
        }
      }
      return json(404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message, ...e.body });
      return json(400, { error: String((e as Error).message || e) });
    }
  }

  async webSocketMessage() { /* 画面からは ping しか来ない（自動で pong を返す） */ }
  async webSocketClose(ws: WebSocket, code: number) { try { ws.close(code, 'closed'); } catch { /* もう閉じている */ } }
}
