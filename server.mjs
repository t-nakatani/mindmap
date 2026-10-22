#!/usr/bin/env node
// マインドマップの小さなサーバー。
// - GET  /            ページ（index.html）
// - GET  /api/map     マップのJSON
// - PUT  /api/map     マップのJSONを丸ごと置き換える
// - GET  /api/events  変更をSSEで流す（ページとCLIのどちらが書いても届く）
// 正本は data/map.json。CLIはこのファイルを直接書き、サーバーはファイルの変化を見て配る。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMap, writeMap, newMap, normalize, DATA_FILE } from './lib/map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4380);
const HOST = process.env.HOST || '127.0.0.1';
const INDEX = path.join(__dirname, 'index.html');

const clients = new Set();
let lastSent = '';

function broadcast(force = false) {
  let text;
  try { text = fs.readFileSync(DATA_FILE, 'utf8'); } catch { return; }
  if (!force && text === lastSent) return;
  lastSent = text;
  const payload = `event: map\ndata: ${JSON.stringify(text)}\n\n`;
  for (const res of clients) res.write(payload);
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(INDEX).pipe(res);
    return;
  }
  if (url.pathname === '/api/map' && req.method === 'GET') {
    let map = readMap();
    if (!map) { map = newMap('中心テーマ'); writeMap(map); }
    return json(res, 200, map);
  }
  if (url.pathname === '/api/map' && req.method === 'PUT') {
    // 塊のまま集めてから文字列にする。塊ごとに文字列へつなぐと、日本語の文字が塊の境目で壊れる
    const chunks = [];
    let size = 0;
    req.on('data', c => { chunks.push(c); size += c.length; if (size > 5e6) req.destroy(); });
    req.on('end', () => {
      try {
        const map = normalize(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (!map || !Array.isArray(map.nodes) || !map.nodes.some(n => !n.parentId)) return json(res, 400, { error: '中心ノードを含む nodes が必要です' });
        writeMap(map);
        lastSent = fs.readFileSync(DATA_FILE, 'utf8');
        // 書いた本人以外にも同じ内容を配る（本人は内容が同じなので無視する）
        const payload = `event: map\ndata: ${JSON.stringify(lastSent)}\n\n`;
        for (const c of clients) c.write(payload);
        json(res, 200, { ok: true });
      } catch (e) { json(res, 400, { error: String(e.message || e) }); }
    });
    return;
  }
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  json(res, 404, { error: 'not found' });
});

// CLIなど外部からの書き込みを拾う。fs.watch は連続して発火するので少し待ってまとめる。
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
let timer = null;
fs.watch(path.dirname(DATA_FILE), (_, name) => {
  if (name && name !== path.basename(DATA_FILE)) return;
  clearTimeout(timer); timer = setTimeout(() => broadcast(), 80);
});
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);

server.listen(PORT, HOST, () => {
  console.log(`mindmap server: http://${HOST}:${PORT}  (data: ${DATA_FILE})`);
});
