// headless Chrome を DevTools のプロトコルで動かし、画面が落ち着いてから撮る（verify shot / dom が使う）。
// chrome --screenshot や --dump-dom は仮想時間で動くので、ノードが親から伸びるアニメーション（requestAnimationFrame）が
// 2コマで止まり、ノードが重なった絵になる。ここでは本当の時間で待ち、全体を表示（#btn-fit）してから撮る。
//
//   node capture.mjs <Chrome の実行ファイル> <プロフィールのフォルダ> <URL> <書き出し先（拡張子なし）> <png|dom>
//
// png: <書き出し先>.png。dom: <書き出し先>.dom.html と、ノードの一覧 <書き出し先>.nodes.txt。
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [chromePath, profile, url, out, mode] = process.argv.slice(2);
if (!chromePath || !profile || !url || !out || !['png', 'dom'].includes(mode)) {
  console.error('使い方: node capture.mjs <chrome> <profile> <url> <out> <png|dom>');
  process.exit(2);
}
mkdirSync(profile, { recursive: true });
const portFile = join(profile, 'DevToolsActivePort');
try { writeFileSync(portFile, ''); } catch {}

const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--window-size=1280,800', '--remote-debugging-port=0', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(msg); chrome.kill(); process.exit(1); };

let wsPath;
for (let i = 0; i < 100 && !wsPath; i++) {
  await sleep(100);
  if (existsSync(portFile)) {
    const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
    if (port && path) wsPath = { port, path };
  }
}
if (!wsPath) fail('Chrome の DevTools につながりません');

// ブラウザ全体の口から、ページのタブを1つ作ってつなぐ
const targets = await (await fetch(`http://127.0.0.1:${wsPath.port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(targets.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('WebSocket')); });
let seq = 0; const waiting = new Map(); const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
  else if (msg.method) events.push(msg.method);
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
for (let i = 0; i < 100 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
if (!events.includes('Page.loadEventFired')) fail(`${url} が読み込めません`);

// ノードが描かれるまで待ち、全体を表示してから、位置が動かなくなるまで待つ
const ready = await evaluate(`new Promise(async (done) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !document.querySelector('g.node[data-id]'); i++) await sleep(100);
  document.querySelector('#btn-fit')?.click();
  let last = '';
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const now = [...document.querySelectorAll('g.node[data-id]')].map((g) => g.getAttribute('transform')).join('|');
    if (now && now === last) return done(true);
    last = now;
  }
  done(false);
})`);
if (!ready) console.error('注意: ノードが落ち着く前に撮りました（ノードが無いか、動き続けている）');

if (mode === 'png') {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}.png`, Buffer.from(data, 'base64'));
  console.log(`${out}.png`);
} else {
  const html = await evaluate('document.documentElement.outerHTML');
  writeFileSync(`${out}.dom.html`, html);
  // 見えているノードだけを、ID・文字・状態（中心・折りたたみ）で書き出す。閉じた枝の中（.hidden）は出さない
  const nodes = await evaluate(`JSON.stringify({ title: document.title, nodes: [...document.querySelectorAll('g.node[data-id]')]
    .filter((g) => !g.classList.contains('hidden'))
    .map((g) => ({ id: g.dataset.id, text: (g.querySelector('text.label')?.textContent.trim() || g.querySelector('text.link-title')?.textContent.trim() || ''),
      tags: ['root', 'collapsed', 'selected'].filter((c) => g.classList.contains(c)) })) })`);
  const { title, nodes: list } = JSON.parse(nodes);
  const lines = [`title: ${title}`, ...list.map((n) => `${n.id}\t${n.text}${n.tags.length ? `\t[${n.tags.join(' ')}]` : ''}`)];
  writeFileSync(`${out}.nodes.txt`, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
ws.close(); chrome.kill();
process.exit(0);
