// マップのファイル入出力と、ツリー操作。サーバーとCLIで共有する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_FILE = process.env.MINDMAP_FILE
  ? path.resolve(process.env.MINDMAP_FILE)
  : path.join(__dirname, '..', 'data', 'map.json');

export function readMap(file = DATA_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function writeMap(map, file = DATA_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function makeNode(map, text, parentId) {
  return { id: 'n' + (map.uid++), text, parentId, children: [], side: 'right', pinned: false, dx: 0, dy: 0, colorIndex: 0, collapsed: false };
}

export function newMap(title) {
  const map = { rootId: null, rootPos: { x: 0, y: 0 }, uid: 1, nodes: [] };
  const root = makeNode(map, title, null);
  map.rootId = root.id; map.nodes.push(root);
  return map;
}

export function index(map) {
  const byId = new Map();
  for (const n of map.nodes) byId.set(n.id, n);
  return byId;
}

export function root(map) { return index(map).get(map.rootId); }

/** ID、完全一致の名前、または「親/子/孫」の経路でノードを引く。曖昧なら候補つきで例外。 */
export function resolve(map, ref) {
  const byId = index(map);
  if (byId.has(ref)) return byId.get(ref);
  if (ref.includes('/')) {
    const segs = ref.split('/').map(s => s.trim()).filter(Boolean);
    let cur = byId.get(map.rootId);
    if (segs[0] === cur.text) segs.shift();
    for (const seg of segs) {
      const kids = cur.children.map(id => byId.get(id)).filter(k => k.text === seg || k.id === seg);
      if (kids.length !== 1) throw new Error(`経路「${ref}」の「${seg}」が ${kids.length ? '複数あります' : '見つかりません'}（${cur.text} の下）`);
      cur = kids[0];
    }
    return cur;
  }
  const hits = map.nodes.filter(n => n.text === ref);
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) throw new Error(`ノード「${ref}」が見つかりません。show で名前と ID を確認してください`);
  throw new Error(`「${ref}」が複数あります。ID で指定してください: ` + hits.map(n => `${n.id}（${pathOf(map, n)}）`).join(', '));
}

export function pathOf(map, n) {
  const byId = index(map);
  const segs = [];
  let cur = n;
  while (cur && cur.id !== map.rootId) { segs.unshift(cur.text); cur = byId.get(cur.parentId); }
  return segs.join('/') || byId.get(map.rootId).text;
}

export function subtree(map, n, acc = []) {
  const byId = index(map);
  acc.push(n);
  for (const id of n.children) subtree(map, byId.get(id), acc);
  return acc;
}

function nextColor(map) { return root(map).children.length % 8; }
function balancedSide(map) {
  const byId = index(map);
  const kids = root(map).children.map(id => byId.get(id));
  const right = kids.filter(k => k.side === 'right').length;
  return right <= kids.length - right ? 'right' : 'left';
}

export function addChild(map, parent, text, { after = null } = {}) {
  const n = makeNode(map, text, parent.id);
  if (parent.id === map.rootId) { n.side = balancedSide(map); n.colorIndex = nextColor(map); }
  parent.collapsed = false;
  map.nodes.push(n);
  const i = after ? parent.children.indexOf(after.id) : -1;
  if (i >= 0) parent.children.splice(i + 1, 0, n.id); else parent.children.push(n.id);
  return n;
}

export function removeNode(map, n) {
  if (n.id === map.rootId) throw new Error('中心ノードは削除できません');
  const byId = index(map);
  const gone = new Set(subtree(map, n).map(x => x.id));
  const p = byId.get(n.parentId);
  p.children = p.children.filter(id => id !== n.id);
  map.nodes = map.nodes.filter(x => !gone.has(x.id));
  return gone.size;
}

export function moveNode(map, n, newParent, { after = null } = {}) {
  if (n.id === map.rootId) throw new Error('中心ノードは動かせません');
  if (subtree(map, n).some(x => x.id === newParent.id)) throw new Error('自分の子孫の下には移せません');
  const byId = index(map);
  const op = byId.get(n.parentId);
  op.children = op.children.filter(id => id !== n.id);
  n.parentId = newParent.id; n.pinned = false; n.dx = 0; n.dy = 0;
  if (newParent.id === map.rootId) { n.side = balancedSide(map); n.colorIndex = nextColor(map); }
  newParent.collapsed = false;
  const i = after ? newParent.children.indexOf(after.id) : -1;
  if (i >= 0) newParent.children.splice(i + 1, 0, n.id); else newParent.children.push(n.id);
}

/** 階層つきの箇条書きにする。withIds なら ID と状態も付ける。 */
export function outline(map, { withIds = false, from = null } = {}) {
  const byId = index(map);
  const lines = [];
  const walk = (n, depth) => {
    let line = '  '.repeat(depth) + '- ' + n.text;
    if (withIds) {
      const marks = [];
      if (n.pinned) marks.push('固定');
      if (n.collapsed) marks.push(`折りたたみ:${subtree(map, n).length - 1}`);
      line += `  (${n.id}${marks.length ? ' ' + marks.join(' ') : ''})`;
    }
    lines.push(line);
    for (const id of n.children) walk(byId.get(id), depth + 1);
  };
  const start = from || root(map);
  if (start.id === map.rootId && !withIds) {
    lines.push('# ' + start.text);
    for (const id of start.children) walk(byId.get(id), 0);
  } else walk(start, 0);
  return lines.join('\n') + '\n';
}

/** Markdown の箇条書きを {text, children} の木に読む。先頭の「# 見出し」は title として返す。 */
export function parseOutline(text) {
  let title = null;
  const items = [];
  const stack = [{ indent: -1, children: items }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const h = raw.match(/^#\s+(.+?)\s*$/);
    if (h && title === null && items.length === 0) { title = h[1]; continue; }
    const m = raw.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*?)\s*$/);
    if (!m) throw new Error(`箇条書きとして読めない行があります: ${raw}`);
    const indent = m[1].replace(/\t/g, '    ').length;
    const item = { text: m[2], children: [] };
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].children.push(item);
    stack.push({ indent, children: item.children });
  }
  return { title, items };
}

export function addTree(map, parent, items) {
  let count = 0;
  for (const it of items) {
    const n = addChild(map, parent, it.text);
    count += 1 + addTree(map, n, it.children);
  }
  return count;
}
