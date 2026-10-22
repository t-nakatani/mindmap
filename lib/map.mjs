// マップのファイル入出力と、ツリー操作。サーバーとCLIで共有する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_FILE = process.env.MINDMAP_FILE
  ? path.resolve(process.env.MINDMAP_FILE)
  : path.join(__dirname, '..', 'data', 'map.json');

export function readMap(file = DATA_FILE) {
  try { return normalize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}

/** 中心ノードが1つだった頃の形式（rootId と rootPos）を、いまの形式に直す。 */
export function normalize(map) {
  if (map && map.rootId) {
    const r = map.nodes.find(n => n.id === map.rootId);
    if (r && map.rootPos) { r.dx = map.rootPos.x; r.dy = map.rootPos.y; }
    delete map.rootId; delete map.rootPos;
  }
  return map;
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
  const map = { uid: 1, nodes: [] };
  map.nodes.push(makeNode(map, title, null));
  return map;
}

/** 親のないノードが中心ノード。中心ノードの dx, dy はキャンバス上の位置。 */
export function roots(map) { return map.nodes.filter(n => !n.parentId); }

/** 新しい中心ノードの位置。既存のマップのいちばん下のさらに下にする。 */
function nextRootPos(map) {
  const rs = roots(map);
  if (!rs.length) return { dx: 0, dy: 0 };
  return { dx: Math.min(...rs.map(r => r.dx)), dy: Math.max(...rs.map(r => r.dy)) + 400 };
}

export function addRoot(map, text) {
  const n = makeNode(map, text, null);
  Object.assign(n, nextRootPos(map));
  map.nodes.push(n);
  return n;
}

export function index(map) {
  const byId = new Map();
  for (const n of map.nodes) byId.set(n.id, n);
  return byId;
}

/** ID、完全一致の名前、または「親/子/孫」の経路でノードを引く。曖昧なら候補つきで例外。
 * 経路の先頭は中心ノードの名前。中心ノードの子から書いてもよい。 */
export function resolve(map, ref) {
  const byId = index(map);
  if (byId.has(ref)) return byId.get(ref);
  if (ref.includes('/')) {
    const segs = ref.split('/').map(s => s.trim()).filter(Boolean);
    const match = (list, seg) => list.filter(k => k.text === seg || k.id === seg);
    const rs = roots(map);
    let cands = match(rs, segs[0]);
    if (cands.length) segs.shift();
    else cands = rs;
    let where = '中心ノード';
    for (const seg of segs) {
      const kids = match(cands.flatMap(c => c.children.map(id => byId.get(id))), seg);
      if (kids.length !== 1) throw new Error(`経路「${ref}」の「${seg}」が ${kids.length ? '複数あります' : '見つかりません'}（${where} の下）`);
      cands = kids; where = seg;
    }
    if (cands.length !== 1) throw new Error(`経路「${ref}」の中心ノードが複数あります。ID で指定してください`);
    return cands[0];
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
  while (cur) { segs.unshift(cur.text); cur = byId.get(cur.parentId); }
  return segs.join('/');
}

export function subtree(map, n, acc = []) {
  const byId = index(map);
  acc.push(n);
  for (const id of n.children) subtree(map, byId.get(id), acc);
  return acc;
}

function nextColor(root) { return root.children.length % 8; }
function balancedSide(map, root) {
  const byId = index(map);
  const kids = root.children.map(id => byId.get(id));
  const right = kids.filter(k => k.side === 'right').length;
  return right <= kids.length - right ? 'right' : 'left';
}

export function addChild(map, parent, text, { after = null } = {}) {
  const n = makeNode(map, text, parent.id);
  if (!parent.parentId) { n.side = balancedSide(map, parent); n.colorIndex = nextColor(parent); }
  parent.collapsed = false;
  map.nodes.push(n);
  const i = after ? parent.children.indexOf(after.id) : -1;
  if (i >= 0) parent.children.splice(i + 1, 0, n.id); else parent.children.push(n.id);
  return n;
}

export function removeNode(map, n) {
  if (!n.parentId && roots(map).length === 1) throw new Error('最後の中心ノードは削除できません');
  const byId = index(map);
  const gone = new Set(subtree(map, n).map(x => x.id));
  const p = byId.get(n.parentId);
  if (p) p.children = p.children.filter(id => id !== n.id);
  map.nodes = map.nodes.filter(x => !gone.has(x.id));
  return gone.size;
}

function detach(map, n) {
  const op = index(map).get(n.parentId);
  if (op) op.children = op.children.filter(id => id !== n.id);
}

/** 別の親の下へ移す。中心ノードを移すと、そのマップは移し先の枝になる。 */
export function moveNode(map, n, newParent, { after = null } = {}) {
  if (subtree(map, n).some(x => x.id === newParent.id)) throw new Error('自分の子孫の下には移せません');
  detach(map, n);
  n.parentId = newParent.id; n.pinned = false; n.dx = 0; n.dy = 0;
  if (!newParent.parentId) { n.side = balancedSide(map, newParent); n.colorIndex = nextColor(newParent); }
  newParent.collapsed = false;
  const i = after ? newParent.children.indexOf(after.id) : -1;
  if (i >= 0) newParent.children.splice(i + 1, 0, n.id); else newParent.children.push(n.id);
}

/** 枝を切り離して、独立したマップの中心ノードにする。 */
export function makeRoot(map, n) {
  if (!n.parentId) throw new Error(`${n.text} はすでに中心ノードです`);
  const pos = nextRootPos(map);
  detach(map, n);
  Object.assign(n, { parentId: null, pinned: false, side: 'right', colorIndex: 0 }, pos);
  const byId = index(map);
  n.children.forEach((id, i) => Object.assign(byId.get(id), { side: i % 2 ? 'left' : 'right', colorIndex: i % 8 }));
}

/** 階層つきの箇条書きにする。withIds なら ID と状態も付ける。
 * ID なしでマップ全体を書くときは、中心ノードごとに「# 見出し」を立てる。 */
export function outline(map, { withIds = false, from = null } = {}) {
  const byId = index(map);
  const lines = [];
  const walk = (n, depth) => {
    let line = '  '.repeat(depth) + '- ' + n.text;
    if (withIds) {
      const marks = [];
      if (!n.parentId) marks.push('中心');
      if (n.pinned) marks.push('固定');
      if (n.collapsed) marks.push(`折りたたみ:${subtree(map, n).length - 1}`);
      line += `  (${n.id}${marks.length ? ' ' + marks.join(' ') : ''})`;
    }
    lines.push(line);
    for (const id of n.children) walk(byId.get(id), depth + 1);
  };
  for (const start of from ? [from] : roots(map)) {
    if (!start.parentId && !withIds) {
      if (lines.length) lines.push('');
      lines.push('# ' + start.text);
      for (const id of start.children) walk(byId.get(id), 0);
    } else walk(start, 0);
  }
  return lines.join('\n') + '\n';
}

/** Markdown の箇条書きを {text, children} の木の並びに読む。
 * 「# 見出し」はその下の箇条書きを子に持つ木になる。見出しの前の箇条書きは最上位の項目がそれぞれ木になる。
 * headed は見出しがあったかどうか。 */
export function parseOutline(text) {
  const trees = [];
  let headed = false;
  let stack = [{ indent: -1, children: trees }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const h = raw.match(/^#\s+(.+?)\s*$/);
    if (h) {
      const item = { text: h[1], children: [] };
      trees.push(item); headed = true;
      stack = [{ indent: -1, children: item.children }];
      continue;
    }
    const m = raw.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*?)\s*$/);
    if (!m) throw new Error(`箇条書きとして読めない行があります: ${raw}`);
    const indent = m[1].replace(/\t/g, '    ').length;
    const item = { text: m[2], children: [] };
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].children.push(item);
    stack.push({ indent, children: item.children });
  }
  return { trees, headed };
}

export function addTree(map, parent, items) {
  let count = 0;
  for (const it of items) {
    const n = addChild(map, parent, it.text);
    count += 1 + addTree(map, n, it.children);
  }
  return count;
}

/** 木の並びを、それぞれ独立したマップとして足す。 */
export function addRoots(map, trees) {
  let count = 0;
  for (const t of trees) count += 1 + addTree(map, addRoot(map, t.text), t.children);
  return count;
}
