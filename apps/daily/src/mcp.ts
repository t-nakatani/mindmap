// エージェント向けの MCP サーバー（Streamable HTTP、POST /mcp に JSON-RPC、返事は JSON）。
// OAuth（src/worker.ts の OAuthProvider）を通ったリクエストだけが来る。ctx.props.email の人の Durable Object を読み書きする。
// 道具は ToDo（一覧・追加・更新・削除）とマップ（箇条書きで見る・操作を当てる）。日付を省くと東京の今日。
import { newMap, outline, normalize, OPS } from '@t-nakatani/mindmap-core';
import type { MindMap } from '@t-nakatani/mindmap-core';

const SERVER = { name: 'daily-todo', version: '0.1.0' };
const PROTOCOLS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];
const WD = ['日', '月', '火', '水', '木', '金', '土'];

const todayTokyo = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
const label = (day: string) => { const d = new Date(day + 'T00:00:00Z'); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`; };
const mapName = (day: string) => `daily-${day}`;

const DAY = { type: 'string', description: '日付（YYYY-MM-DD）。省くと今日（東京）' };
const TOOLS = [
  { name: 'todo_list', description: 'その日の ToDo の一覧。今日を見ると、前の日の未完了を持ち越す。', inputSchema: { type: 'object', properties: { day: DAY } },
    annotations: { readOnlyHint: true } },
  { name: 'todo_add', description: 'ToDo を末尾に足す。', inputSchema: { type: 'object', properties: { day: DAY, text: { type: 'string', description: 'ToDo の文字（500 文字まで）' } }, required: ['text'] } },
  { name: 'todo_update', description: 'ToDo の文字か完了を直す。id は todo_list の id。', inputSchema: { type: 'object',
    properties: { id: { type: 'number' }, text: { type: 'string' }, done: { type: 'boolean' } }, required: ['id'] } },
  { name: 'todo_delete', description: 'ToDo を消す。', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    annotations: { destructiveHint: true } },
  { name: 'map_show', description: 'その日のマインドマップを箇条書きで見る。括弧の中がノードの ID。', inputSchema: { type: 'object', properties: { day: DAY } },
    annotations: { readOnlyHint: true } },
  { name: 'map_op', description: [
    'その日のマインドマップに操作を1つ当てる（マップが無ければ作る）。画面にはすぐ反映される。',
    'ノードは ID（n6）、完全一致の名前、経路（中心/市場/海外）で指す。操作の前に map_show で名前と ID を確かめる。',
    'add {text, under?, after?, root?, url?} / rename {node, text} / move {node, under? | root:true, after?} / remove {node}（子ごと消える）',
    'layout {node, mode: both|right|left} / side {node, side: left|right} / collapse {node} / expand {node}',
    'import {text: Markdown の箇条書き, under?}（replace は使わない）/ link {node, url} / unlink {node}',
  ].join('\n'), inputSchema: { type: 'object', properties: {
    day: DAY, op: { type: 'string', enum: [...OPS] },
    args: { type: 'object', description: '操作の引数（説明のとおり）', properties: {
      text: { type: 'string' }, node: { type: 'string' }, under: { type: 'string' }, after: { type: 'string' },
      root: { type: 'boolean' }, mode: { type: 'string' }, side: { type: 'string' }, url: { type: 'string' } } },
  }, required: ['op'] } },
];

class ToolError extends Error {}

type Store = (path: string, init?: RequestInit) => Promise<Response>;

async function call(store: Store, name: string, a: Record<string, any>): Promise<string> {
  const day = typeof a.day === 'string' && a.day ? a.day : todayTokyo();
  const body = async (r: Response) => {
    const data = await r.json().catch(() => ({})) as any;
    if (!r.ok) throw new ToolError(data.error || `失敗しました（${r.status}）`);
    return data;
  };
  const send = (method: string, path: string, json: unknown) =>
    store(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
  const todos = (data: any) => {
    const list = data.todos as any[];
    if (!list.length) return `${data.day} の ToDo はありません。`;
    const lines = list.map(t => `- [${t.done ? 'x' : ' '}] ${t.text}  (id ${t.id}${t.carriedFrom ? `、${t.carriedFrom} から持ち越し` : ''}${t.carriedTo ? `、${t.carriedTo} へ持ち越し` : ''})`);
    return `${data.day} の ToDo（${list.filter(t => t.done).length} / ${list.length} 完了）\n${lines.join('\n')}`;
  };
  switch (name) {
    case 'todo_list': return todos(await body(await store(`/api/todos?day=${encodeURIComponent(day)}&today=${todayTokyo()}`)));
    case 'todo_add': return todos(await body(await send('POST', '/api/todos', { day, text: a.text })));
    case 'todo_update': return todos(await body(await send('PATCH', '/api/todos', { id: a.id, text: a.text, done: a.done })));
    case 'todo_delete': return todos(await body(await send('DELETE', '/api/todos', { id: a.id })));
    case 'map_show': {
      const r = await store(`/api/mindmap/map?name=${mapName(day)}`);
      if (r.status === 404) return `${day} のマップはまだありません（map_op の add で作れます。中心は「${label(day)}」）。`;
      const { version, name: _n, ...map } = await body(r);
      const m = normalize(map as MindMap);
      // 両側に枝を出す中心では、子が左右どちらにあるかを添える（画面での分け方を読めるように）
      const sides = m.nodes.filter(n => !n.parentId && (n.layout || 'both') === 'both').map(r => {
        const kids = r.children.map(id => m.nodes.find(n => n.id === id)!).filter(Boolean);
        const pick = (side: string) => kids.filter(k => (k.side || 'right') === side).map(k => `${k.text} (${k.id})`).join('、') || 'なし';
        return `${r.text} (${r.id}) の枝の向き\n  右: ${pick('right')}\n  左: ${pick('left')}`;
      });
      return outline(m, { withIds: true }) + (sides.length ? '\n' + sides.join('\n') + '\n' : '');
    }
    case 'map_op': {
      const args = { ...(a.args || {}) };
      if (a.op === 'import' && args.replace) throw new ToolError('import の replace は使えません（人の置いた位置が消えるため）。under を使ってください。');
      // マップが無ければ、画面と同じ中心ノード（日付）で作る
      const got = await store(`/api/mindmap/map?name=${mapName(day)}`);
      if (got.status === 404) await body(await send('PUT', `/api/mindmap/map?name=${mapName(day)}`, { baseVersion: 0, map: newMap(label(day)) }));
      else await body(got);
      const res = await body(await send('POST', `/api/mindmap/op?name=${mapName(day)}`, { op: a.op, args }));
      return res.message;
    }
  }
  throw new ToolError(`知らない道具です: ${name}`);
}

function rpc(id: unknown, result: unknown) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id: unknown, code: number, message: string) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; }

/** POST /mcp を受ける。store は、その人の Durable Object へ API を投げる関数。 */
export async function handleMcp(request: Request, store: Store): Promise<Response> {
  if (request.method === 'GET') return new Response(null, { status: 405, headers: { Allow: 'POST' } }); // SSE の配信はしない
  if (request.method === 'DELETE') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  let msg: any;
  try { msg = await request.json(); } catch { return Response.json(rpcError(null, -32700, 'JSON ではありません'), { status: 400 }); }
  const batch = Array.isArray(msg);
  const out: unknown[] = [];
  for (const m of batch ? msg : [msg]) {
    const r = await one(m, store);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(batch ? out : out[0], { headers: { 'Cache-Control': 'no-store' } });
}

async function one(m: any, store: Store): Promise<unknown | null> {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return rpcError(m?.id, -32600, '不正なリクエストです');
  if (m.id === undefined) return null; // 通知（notifications/initialized など）
  switch (m.method) {
    case 'initialize': {
      const asked = m.params?.protocolVersion;
      return rpc(m.id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions: 'Tomoya の日次 ToDo とその日のマインドマップ。日付は YYYY-MM-DD、省くと東京の今日。マップを触る前に map_show で名前と ID を確かめる。削除は頼まれたときだけ。',
      });
    }
    case 'ping': return rpc(m.id, {});
    case 'tools/list': return rpc(m.id, { tools: TOOLS });
    case 'tools/call': {
      const name = m.params?.name, args = m.params?.arguments || {};
      try {
        return rpc(m.id, { content: [{ type: 'text', text: await call(store, name, args) }] });
      } catch (e) {
        if (e instanceof ToolError) return rpc(m.id, { content: [{ type: 'text', text: e.message }], isError: true });
        throw e;
      }
    }
    case 'resources/list': return rpc(m.id, { resources: [] });
    case 'prompts/list': return rpc(m.id, { prompts: [] });
  }
  return rpcError(m.id, -32601, `知らないメソッドです: ${m.method}`);
}
