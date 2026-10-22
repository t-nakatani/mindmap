#!/usr/bin/env node
// マインドマップの小さなサーバー。
// - GET  /                    ページ（index.html）
// - GET  /api/maps            マップの一覧と、今選んでいる名前
// - POST /api/maps            新しいマップを作って選ぶ  {name, title}
// - PUT  /api/current         選ぶマップを変える        {name}
// - GET  /api/map[?name=]     マップのJSON（name を省くと今選んでいるもの）
// - PUT  /api/map[?name=]     マップのJSONを丸ごと置き換える
// - GET  /api/events          変更をSSEで流す（map / current / maps）
// 正本は data/<名前>.json。CLIはファイルを直接書き、サーバーはフォルダの変化を見て配る。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMap, writeMap, newMap, normalize, listMaps, currentName, setCurrent, mapExists, mapFile, cleanName, DATA_DIR } from './lib/map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4380);
const HOST = process.env.HOST || '127.0.0.1';
const INDEX = path.join(__dirname, 'index.html');

const clients = new Set();
const lastSent = new Map(); // name → 最後に配ったファイルの中身
let lastCurrent = null;

function send(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}
function broadcastMap(name, force = false) {
  let text;
  try { text = fs.readFileSync(mapFile(name), 'utf8'); } catch { return; }
  if (!force && text === lastSent.get(name)) return;
  lastSent.set(name, text);
  send('map', { name, text });
}
function broadcastCurrent() {
  const cur = currentName();
  if (cur === lastCurrent) return;
  lastCurrent = cur;
  send('current', cur);
}
function broadcastMaps() { send('maps', { current: currentName(), maps: listMaps() }); }

/** マップが1つも無ければ「map」を作って選ぶ。 */
function ensureAny() {
  let cur = currentName();
  if (!cur) { writeMap(newMap('中心テーマ'), 'map'); cur = setCurrent('map'); }
  return cur;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    // 塊のまま集めてから文字列にする。塊ごとに文字列へつなぐと、日本語の文字が塊の境目で壊れる
    const chunks = []; let size = 0;
    req.on('data', c => { chunks.push(c); size += c.length; if (size > 5e6) req.destroy(new Error('too large')); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      fs.createReadStream(INDEX).pipe(res);
      return;
    }
    if (url.pathname === '/api/maps' && req.method === 'GET') {
      ensureAny();
      return json(res, 200, { current: currentName(), maps: listMaps() });
    }
    if (url.pathname === '/api/maps' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const name = cleanName(body.name);
      if (mapExists(name)) return json(res, 409, { error: `マップ「${name}」はもうあります` });
      writeMap(newMap(String(body.title || name)), name);
      setCurrent(name);
      broadcastMaps(); broadcastCurrent();
      return json(res, 200, { ok: true, name });
    }
    if (url.pathname === '/api/current' && req.method === 'PUT') {
      const body = JSON.parse(await readBody(req) || '{}');
      const name = setCurrent(body.name);
      broadcastCurrent();
      return json(res, 200, { ok: true, name });
    }
    if (url.pathname === '/api/map' && req.method === 'GET') {
      const name = url.searchParams.get('name') ? cleanName(url.searchParams.get('name')) : ensureAny();
      const map = readMap(name);
      if (!map) return json(res, 404, { error: `マップ「${name}」がありません` });
      return json(res, 200, { ...map, name });
    }
    if (url.pathname === '/api/map' && req.method === 'PUT') {
      const name = url.searchParams.get('name') ? cleanName(url.searchParams.get('name')) : ensureAny();
      const map = normalize(JSON.parse(await readBody(req)));
      if (!map || !Array.isArray(map.nodes) || !map.nodes.some(n => !n.parentId)) return json(res, 400, { error: '中心ノードを含む nodes が必要です' });
      const isNew = !mapExists(name);
      writeMap(map, name);
      // 書いた本人以外にも同じ内容を配る（本人は内容が同じなので無視する）
      broadcastMap(name, true);
      if (isNew) broadcastMaps();
      return json(res, 200, { ok: true, name });
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 400, { error: String(e.message || e) });
  }
});

// CLIなど外部からの書き込みを拾う。fs.watch は連続して発火するので少し待ってまとめる。
fs.mkdirSync(DATA_DIR, { recursive: true });
lastCurrent = currentName();
const pending = new Set();
let timer = null;
fs.watch(DATA_DIR, (_, name) => {
  if (!name) return;
  pending.add(String(name));
  clearTimeout(timer);
  timer = setTimeout(() => {
    const names = [...pending]; pending.clear();
    let listChanged = false;
    for (const f of names) {
      if (f === '.current') broadcastCurrent();
      else if (f.endsWith('.json')) {
        const n = f.slice(0, -5);
        if (mapExists(n)) broadcastMap(n); else lastSent.delete(n);
        listChanged = true; // 追加・削除だけでなく、題名（最初の中心ノード）が変わることもある
      }
    }
    if (listChanged) broadcastMaps();
    broadcastCurrent(); // 選んでいたマップが消えたときも拾う
  }, 80);
});
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);

server.listen(PORT, HOST, () => {
  console.log(`mindmap server: http://${HOST}:${PORT}  (maps: ${DATA_DIR})`);
});
