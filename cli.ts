#!/usr/bin/env node
// マインドマップを名前指定で操作する CLI。Cloudflare の Worker の API を呼び、書き込みはサーバー側
// （Durable Object）で行う。ページには WebSocket で即時に反映される。
// node cli.ts でそのまま動く（Node 23.6 以上の型の取り除き）。
import fs from 'node:fs';
import path from 'node:path';
import { normalize, resolve, outline, cleanName, isMap } from './lib/map.ts';
import type { MindMap, MapNode } from './lib/map.ts';
import type { OpArgs } from './lib/ops.ts';

const BASE_URL = (process.env.MINDMAP_URL || 'http://127.0.0.1:4381').replace(/\/+$/, '');

const USAGE = `使い方: node cli.ts <コマンド> [引数] [オプション]

  maps                                 マップの一覧。* が今選んでいるもの
  use <マップ名>                       操作と画面の対象にするマップを切り替える
  new <題名> --map <マップ名>          新しいマップを作る。切り替えは use で
  show [ノード]                        階層を ID と状態つきで表示する
  export [ノード]                      Markdown の箇条書きで出力する（ID なし）
  add <文字> --under <ノード> [--after <ノード>]
                                       子ノードを足す。--after で兄弟の後ろに入れる
  add <文字> --root                    新しい中心ノード（独立したマップ）を足す
  rename <ノード> <文字>               名前を変える
  move <ノード> --under <ノード> [--after <ノード>]
                                       別の親の下へ移す（子ごと）
  move <ノード> --root                 枝を切り離して、独立したマップにする
  remove <ノード>                      ノードを子ごと消す
  collapse <ノード> / expand <ノード>  枝を折りたたむ / 開く
  layout <中心ノード> <both|right|left>
                                       マップの配置を両側・右だけ・左だけにする
  side <ノード> <left|right>           ノードを含む枝を中心の左か右へ出す（片側のマップは両側になる）
  import <ファイル|-> [--under <ノード> | --root] [--replace]
                                       Markdown の箇条書きを取り込む。「# 見出し」は中心ノードになる
                                       --replace はすべてのマップを作り直す
  new <題名>                           今のマップを中心ノード1つだけにして作り直す
  migrate [フォルダ] [--replace]       ファイル時代の <フォルダ>/<マップ名>.json と .current をサーバーへ移す
                                       （既定は data/）。同じ名前のマップは --replace のときだけ上書きする

どのコマンドも --map <マップ名> で対象のマップを変えられる（省くと use で選んだもの）。
中心ノードは複数置ける。それぞれが独立したマップになる。
--under を省くと、中心ノードが1つのときはその下に入る。複数あるときは --under か --root が必要。
ノードの指定: ID（n12）、完全一致の名前、または「中心/予算/人件費」のような経路（中心は省ける）。
名前が複数あるときは ID か経路で指定する。

環境変数:
  MINDMAP_URL                  サーバー（既定は手元の開発サーバー http://127.0.0.1:4381）
  MINDMAP_ACCESS_CLIENT_ID     Cloudflare Access のサービストークン（デプロイ先を使うとき）
  MINDMAP_ACCESS_CLIENT_SECRET 同じく
  MINDMAP_MAP                  既定のマップ名（省くと use で選んだもの）`;

type Opts = { under?: string; after?: string; map?: string; replace?: boolean; root?: boolean; help?: boolean };

function parseArgs(argv: string[]) {
  const pos: string[] = [], opt: Opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--under' || a === '--after' || a === '--map') opt[a.slice(2) as 'under' | 'after' | 'map'] = argv[++i];
    else if (a === '--replace' || a === '--root' || a === '--help') opt[a.slice(2) as 'replace' | 'root' | 'help'] = true;
    else if (a === '-h') opt.help = true;
    else pos.push(a);
  }
  return { pos, opt };
}

function need(v: string | undefined, what: string): string { if (v === undefined || v === '') throw new Error(`${what} が必要です`); return v; }

// ---------- API ----------

async function api<T = any>(method: string, apiPath: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const id = process.env.MINDMAP_ACCESS_CLIENT_ID, secret = process.env.MINDMAP_ACCESS_CLIENT_SECRET;
  if (id && secret) { headers['CF-Access-Client-Id'] = id; headers['CF-Access-Client-Secret'] = secret; }
  let r: Response;
  try {
    r = await fetch(BASE_URL + apiPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  } catch {
    throw new Error(`サーバーに届きません: ${BASE_URL}。開発サーバー（npm run dev）が動いているか、MINDMAP_URL を確かめてください`);
  }
  const text = await r.text();
  let data: any;
  try { data = JSON.parse(text); } catch {
    if (r.status >= 300 && r.status < 400 || /<html/i.test(text)) {
      throw new Error(`Cloudflare Access に止められました（${r.status}）。MINDMAP_ACCESS_CLIENT_ID と MINDMAP_ACCESS_CLIENT_SECRET を確かめてください`);
    }
    throw new Error(`サーバーの応答が読めません（${r.status}）: ${text.slice(0, 200)}`);
  }
  if (!r.ok) throw new Error(data.error || `サーバーがエラーを返しました（${r.status}）`);
  return data as T;
}

function q(name: string | null) { return name ? '?name=' + encodeURIComponent(name) : ''; }

async function getMap(name: string | null): Promise<MindMap & { name: string; version: number }> {
  const m = await api('GET', '/api/map' + q(name));
  const mapName = m.name, version = m.version;
  return Object.assign(normalize(m), { name: mapName, version });
}

async function op(name: string | null, opName: string, args: OpArgs): Promise<void> {
  const res = await api('POST', '/api/op' + q(name), { op: opName, args });
  console.log(res.message);
}

// ---------- コマンド ----------

async function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || opt.help) { console.log(USAGE); return; }

  if (cmd === 'maps') {
    const { current, maps } = await api('GET', '/api/maps');
    if (!maps.length) { console.log('マップがありません。new <題名> --map <マップ名> で作るか、migrate で移してください'); return; }
    const fmt = (iso: string) => { const d = new Date(iso), z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
    for (const m of maps) console.log(`${m.name === current ? '*' : ' '} ${m.name}\t${m.title}\t中心 ${m.roots} 件\t${fmt(m.updatedAt)}`);
    return;
  }
  if (cmd === 'use') {
    const res = await api('PUT', '/api/current', { name: cleanName(need(pos[1], 'マップ名')) });
    console.log(`選択: ${res.name}（画面も切り替わります）`);
    return;
  }
  if (cmd === 'migrate') {
    const dir = path.resolve(pos[1] || 'data');
    const maps: Record<string, MindMap> = {};
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('.')) continue;
      const m = normalize(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      if (!isMap(m)) throw new Error(`${f} はマップとして読めません`);
      maps[cleanName(f)] = m;
    }
    if (!Object.keys(maps).length) throw new Error(`${dir} にマップ（*.json）がありません`);
    let current: string | undefined;
    try { current = fs.readFileSync(path.join(dir, '.current'), 'utf8').trim() || undefined; } catch { /* 無くてよい */ }
    const res = await api('POST', '/api/import', { maps, current, replace: !!opt.replace });
    if (res.added.length) console.log(`追加: ${res.added.join(', ')}`);
    if (res.replaced.length) console.log(`上書き: ${res.replaced.join(', ')}`);
    if (res.skipped.length) console.log(`スキップ（もうある）: ${res.skipped.join(', ')}。上書きするなら --replace を付けてください`);
    console.log(`選択: ${res.current}`);
    return;
  }

  // 対象のマップ名。--map、環境変数の順。どちらも無ければサーバーで今選んでいるもの。
  const mapName = opt.map ? cleanName(opt.map) : (process.env.MINDMAP_MAP ? cleanName(process.env.MINDMAP_MAP) : null);

  switch (cmd) {
    case 'new': {
      const title = need(pos[1], '題名');
      // --map を省くと、今選んでいるマップを作り直す
      const name = mapName ?? (await api('GET', '/api/maps')).current ?? 'map';
      const res = await api('POST', '/api/maps', { name, title, replace: !!opt.replace || !mapName });
      console.log(`マップ「${res.name}」を作りました: ${res.root.text} (${res.root.id})`
        + (res.current !== res.name ? `。画面に出すには: node cli.ts use ${res.name}` : ''));
      return;
    }
    case 'show':
    case 'export': {
      const map = await getMap(mapName);
      const from: MapNode | null = pos[1] ? resolve(map, pos[1]) : null;
      process.stdout.write(outline(map, { withIds: cmd === 'show', from }));
      return;
    }
    case 'add':
      return op(mapName, 'add', { text: need(pos[1], '文字'), under: opt.under, after: opt.after, root: opt.root });
    case 'rename':
      return op(mapName, 'rename', { node: need(pos[1], 'ノード'), text: need(pos[2], '新しい文字') });
    case 'move':
      return op(mapName, 'move', { node: need(pos[1], 'ノード'), under: opt.under, after: opt.after, root: opt.root });
    case 'remove':
    case 'collapse':
    case 'expand':
      return op(mapName, cmd, { node: need(pos[1], 'ノード') });
    case 'layout':
      return op(mapName, 'layout', { node: need(pos[1], '中心ノード'), mode: need(pos[2], '配置（both / right / left）') });
    case 'side':
      return op(mapName, 'side', { node: need(pos[1], 'ノード'), side: need(pos[2], '向き（left / right）') });
    case 'import': {
      const src = need(pos[1], 'ファイル');
      const text = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8');
      return op(mapName, 'import', { text, under: opt.under, root: opt.root, replace: opt.replace });
    }
    default:
      throw new Error(`知らないコマンドです: ${cmd}\n\n${USAGE}`);
  }
}

main().catch(e => { console.error('エラー: ' + (e.message || e)); process.exit(1); });
