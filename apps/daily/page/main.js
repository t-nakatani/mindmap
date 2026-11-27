// 日次 ToDo のページ。部品は npm パッケージとして読み、esbuild で public/assets/main.js にまとめる（npm run page）。
import { defineMindMap, httpStore } from '@t-nakatani/mindmap-element';
defineMindMap();

const $ = id => document.getElementById(id);
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const localDay = (d = new Date()) => d.toLocaleDateString('sv-SE');
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); return localDay(d); };
const label = day => { const d = new Date(day + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const short = day => day.slice(5).replace('-', '/');
const dayFromPath = () => (/^\/(\d{4}-\d{2}-\d{2})$/.exec(location.pathname) || [])[1] || localDay();

let day = dayFromPath(), todos = [];
const map = $('map');

// マップの高さ（覚えておく）
try { const h = localStorage.getItem('daily.mapHeight'); if (h) map.style.setProperty('--map-height', h + 'px'); } catch {}
$('resize').addEventListener('pointerdown', e => {
  const startY = e.clientY, startH = map.getBoundingClientRect().height;
  $('resize').setPointerCapture(e.pointerId);
  const move = ev => map.style.setProperty('--map-height', Math.max(200, Math.min(900, startH + ev.clientY - startY)) + 'px');
  const up = () => {
    $('resize').removeEventListener('pointermove', move);
    try { localStorage.setItem('daily.mapHeight', String(Math.round(map.getBoundingClientRect().height))); } catch {}
  };
  $('resize').addEventListener('pointermove', move);
  $('resize').addEventListener('pointerup', up, { once: true });
});

function notice(msg) { $('notice').hidden = !msg; $('notice').textContent = msg || ''; }

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) { notice('ログインが必要です。ページを読み込み直してください。'); throw new Error('auth'); }
  if (r.status === 503) { notice(data.error || 'ログインの設定がまだです。'); throw new Error('config'); }
  if (!r.ok) { notice(data.error || `うまくいきませんでした（${r.status}）`); throw new Error(String(r.status)); }
  notice('');
  return data;
}

function render() {
  const list = $('list');
  list.textContent = '';
  for (const t of todos) {
    const li = document.createElement('li');
    li.className = t.done ? 'done' : '';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!t.done; cb.setAttribute('aria-label', '完了');
    cb.onchange = () => patch(t.id, { done: cb.checked });
    const text = document.createElement('input');
    text.className = 'text'; text.value = t.text;
    text.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) text.blur(); if (e.key === 'Escape') { text.value = t.text; text.blur(); } };
    text.onblur = () => { const v = text.value.trim(); if (v && v !== t.text) patch(t.id, { text: v }); else text.value = t.text; };
    li.append(cb, text);
    if (t.carriedFrom) { const m = document.createElement('span'); m.className = 'meta'; m.textContent = `${short(t.carriedFrom)} から持ち越し`; li.append(m); }
    if (t.carriedTo) { const m = document.createElement('span'); m.className = 'meta'; m.textContent = `${short(t.carriedTo)} へ持ち越し`; li.append(m); }
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '×'; del.title = '消す'; del.setAttribute('aria-label', '消す');
    del.onclick = () => remove(t.id);
    li.append(del);
    list.append(li);
  }
  const done = todos.filter(t => t.done).length;
  $('count').textContent = todos.length ? `${done} / ${todos.length} 完了` : '';
  $('left').textContent = todos.length ? `残り ${todos.length - done} 件` : '';
  $('empty').hidden = todos.length > 0;
}

async function loadTodos() {
  const want = day;
  try {
    const data = await api('GET', `/api/todos?day=${want}&today=${localDay()}`);
    if (want === day) { todos = data.todos; render(); }
  } catch {}
}
// 返事が届くまでに別の日へ移っていたら、その返事は表に出さない
function take(data) { if (data && data.day === day) { todos = data.todos; render(); } }
async function patch(id, change) {
  try { take(await api('PATCH', '/api/todos', { id, ...change })); } catch { render(); }
}
async function remove(id) {
  try { take(await api('DELETE', '/api/todos', { id })); } catch {}
}
$('new').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const text = $('new').value.trim();
  if (!text) return;
  $('new').value = '';
  try { take(await api('POST', '/api/todos', { day, text })); } catch { $('new').value = text; }
});

function show() {
  const today = localDay();
  $('title').textContent = label(day);
  document.title = `${label(day)} — Daily`;
  $('today').toggleAttribute('aria-current', day === today);
  if (day === today) $('today').setAttribute('aria-current', 'date');
  map.setAttribute('root-title', label(day));
  map.store = httpStore({ base: '/api/mindmap', name: `daily-${day}` });
  todos = []; render();
  loadTodos();
}
function go(next) {
  if (next === day) return;
  day = next;
  history.pushState(null, '', '/' + day);
  show();
}
$('prev').onclick = () => go(addDays(day, -1));
$('next').onclick = () => go(addDays(day, 1));
$('today').onclick = () => go(localDay());
addEventListener('popstate', () => { day = dayFromPath(); show(); });
// [ と ] で日を動かす（マップや入力欄の中では効かない）
addEventListener('keydown', e => {
  const t = e.composedPath()[0];
  if (e.metaKey || e.ctrlKey || e.altKey || t.closest?.('input, textarea, [contenteditable], mind-map') || t === map) return;
  if (e.key === '[') go(addDays(day, -1));
  if (e.key === ']') go(addDays(day, 1));
});
addEventListener('pagehide', () => map.flush?.());
show();
