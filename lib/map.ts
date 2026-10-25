// マップのツリー操作。Durable Object（サーバー側）と CLI で共有する。ファイルや通信には触れない。

export type Side = 'left' | 'right';
export type Layout = 'both' | 'right' | 'left';
export interface MapNode {
  id: string;
  text: string;
  /** null なら中心ノード。 */
  parentId: string | null;
  children: string[];
  side: Side;
  /** 中心ノードだけが持つキャンバス上の位置。ほかは常に 0。 */
  dx: number;
  dy: number;
  colorIndex: number;
  collapsed: boolean;
  /** 中心ノードだけが持つ配置。省くと both。 */
  layout?: Layout;
  /** 自由に置けた頃の印。読み込むときに外す。 */
  pinned?: boolean;
}
export interface MindMap {
  uid: number;
  nodes: MapNode[];
  /** 中心ノードが1つだった頃の形。読み込むときに直す。 */
  rootId?: string;
  rootPos?: { x: number; y: number };
  name?: string;
}
/** 箇条書きを読んだ木。 */
export interface OutlineItem { text: string; children: OutlineItem[] }

export function validName(name: unknown): name is string {
  return typeof name === 'string' && /^[^\\/.\s][^\\/]{0,63}$/.test(name) && !/[\x00-\x1f]/.test(name);
}
/** 「foo.json」と書かれても「foo」として扱う。 */
export function cleanName(name: unknown): string {
  const n = String(name ?? '').trim().replace(/\.json$/i, '');
  if (!validName(n)) throw new Error(`マップ名が使えません: ${JSON.stringify(name)}（スラッシュと先頭のドットは不可、64文字まで）`);
  return n;
}
/** 古い形式を、いまの形式に直す。中心ノードが1つだった頃の rootId と rootPos を中心ノードの位置に移し、
 * 中心ノード以外を自由に置けた頃の固定（pinned と dx, dy）を外す。 */
export function normalize(map: MindMap): MindMap {
  if (map && map.rootId) {
    const r = map.nodes.find(n => n.id === map.rootId);
    if (r && map.rootPos) { r.dx = map.rootPos.x; r.dy = map.rootPos.y; }
    delete map.rootId; delete map.rootPos;
  }
  if (map) for (const n of map.nodes) {
    if (n.parentId) { n.dx = 0; n.dy = 0; }
    delete n.pinned;
  }
  if (map) delete map.name;
  return map;
}
/** 外から来た JSON がマップとして使えるか。中心ノードを含む nodes が要る。 */
export function isMap(v: unknown): v is MindMap {
  const m = v as MindMap;
  return !!m && typeof m === 'object' && typeof m.uid === 'number' && Array.isArray(m.nodes) && m.nodes.some(n => n && !n.parentId);
}

export function makeNode(map: MindMap, text: string, parentId: string | null): MapNode {
  return { id: 'n' + (map.uid++), text, parentId, children: [], side: 'right', dx: 0, dy: 0, colorIndex: 0, collapsed: false };
}

export function newMap(title: string): MindMap {
  const map: MindMap = { uid: 1, nodes: [] };
  map.nodes.push(makeNode(map, title, null));
  return map;
}

/** 親のないノードが中心ノード。中心ノードの dx, dy はキャンバス上の位置。 */
export function roots(map: MindMap): MapNode[] { return map.nodes.filter(n => !n.parentId); }

/** 新しい中心ノードの位置。既存のマップのいちばん下のさらに下にする。 */
function nextRootPos(map: MindMap) {
  const rs = roots(map);
  if (!rs.length) return { dx: 0, dy: 0 };
  return { dx: Math.min(...rs.map(r => r.dx)), dy: Math.max(...rs.map(r => r.dy)) + 400 };
}

export function addRoot(map: MindMap, text: string): MapNode {
  const n = makeNode(map, text, null);
  Object.assign(n, nextRootPos(map));
  map.nodes.push(n);
  return n;
}

/** ID からノードを引く表。ID は必ずあるものとして引く（無ければ例外）。 */
class NodeIndex extends Map<string, MapNode> {
  of(id: string | null): MapNode {
    const n = id === null ? undefined : this.get(id);
    if (!n) throw new Error(`ノード ${id} がありません（マップが壊れています）`);
    return n;
  }
}
export function index(map: MindMap): NodeIndex {
  const byId = new NodeIndex();
  for (const n of map.nodes) byId.set(n.id, n);
  return byId;
}

/** ID、完全一致の名前、または「親/子/孫」の経路でノードを引く。曖昧なら候補つきで例外。
 * 経路の先頭は中心ノードの名前。中心ノードの子から書いてもよい。 */
export function resolve(map: MindMap, ref: string): MapNode {
  const byId = index(map);
  const hit = byId.get(ref);
  if (hit) return hit;
  if (ref.includes('/')) {
    const segs = ref.split('/').map(s => s.trim()).filter(Boolean);
    const match = (list: MapNode[], seg: string) => list.filter(k => k.text === seg || k.id === seg);
    const rs = roots(map);
    let cands = match(rs, segs[0]);
    if (cands.length) segs.shift();
    else cands = rs;
    let where = '中心ノード';
    for (const seg of segs) {
      const kids = match(cands.flatMap(c => c.children.map(id => byId.of(id))), seg);
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

export function pathOf(map: MindMap, n: MapNode): string {
  const byId = index(map);
  const segs: string[] = [];
  let cur: MapNode | undefined = n;
  while (cur) { segs.unshift(cur.text); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
  return segs.join('/');
}

export function subtree(map: MindMap, n: MapNode, acc: MapNode[] = []): MapNode[] {
  const byId = index(map);
  acc.push(n);
  for (const id of n.children) subtree(map, byId.of(id), acc);
  return acc;
}

function nextColor(root: MapNode) { return root.children.length % 8; }
export const LAYOUTS: Record<Layout, string> = { both: '両側', right: '右', left: '左' };
/** マップの配置。中心ノードの layout が both（両側）、right（右だけ）、left（左だけ）。 */
export function layoutOf(root: MapNode): Layout { return root.layout || 'both'; }

/** 配置を変える。片側にするときは子をすべてその向きに揃え、両側に戻すときは偏っていれば左右に振り分ける。 */
export function setLayout(map: MindMap, root: MapNode, mode: string): void {
  if (root.parentId) throw new Error(`${root.text} は中心ノードではありません`);
  if (!Object.hasOwn(LAYOUTS, mode)) throw new Error(`配置は ${Object.keys(LAYOUTS).join(' / ')} のどれかです`);
  const m = mode as Layout;
  root.layout = m;
  const byId = index(map);
  const kids = root.children.map(id => byId.of(id));
  if (m !== 'both') for (const k of kids) k.side = m;
  else if (kids.every(k => k.side === kids[0].side)) kids.forEach((k, i) => { k.side = i % 2 ? 'left' : 'right'; });
}

/** n を含む枝（中心ノードの子）を、中心の左か右へ出す。片側だけのマップで反対側へ出すと、そのマップは両側になる。
 * 動かした枝を返す。 */
export function setSide(map: MindMap, n: MapNode, side: string): MapNode {
  if (side !== 'left' && side !== 'right') throw new Error('向きは left か right です');
  if (!n.parentId) throw new Error(`${n.text} は中心ノードです。枝（中心ノードの子か、その子孫）を指定してください`);
  const byId = index(map);
  let b = n;
  while (byId.of(b.parentId).parentId) b = byId.of(b.parentId);
  const root = byId.of(b.parentId);
  if (b.side !== side && layoutOf(root) !== 'both') root.layout = 'both';
  b.side = side;
  return b;
}

/** 中心ノードに子を足すときの向き。両側なら少ない側、片側ならその側。 */
function balancedSide(map: MindMap, root: MapNode): Side {
  const layout = layoutOf(root);
  if (layout !== 'both') return layout;
  const byId = index(map);
  const kids = root.children.map(id => byId.of(id));
  const right = kids.filter(k => k.side === 'right').length;
  return right <= kids.length - right ? 'right' : 'left';
}

export function addChild(map: MindMap, parent: MapNode, text: string, { after = null }: { after?: MapNode | null } = {}): MapNode {
  const n = makeNode(map, text, parent.id);
  if (!parent.parentId) { n.side = balancedSide(map, parent); n.colorIndex = nextColor(parent); }
  parent.collapsed = false;
  map.nodes.push(n);
  const i = after ? parent.children.indexOf(after.id) : -1;
  if (i >= 0) parent.children.splice(i + 1, 0, n.id); else parent.children.push(n.id);
  return n;
}

export function removeNode(map: MindMap, n: MapNode): number {
  if (!n.parentId && roots(map).length === 1) throw new Error('最後の中心ノードは削除できません');
  const gone = new Set(subtree(map, n).map(x => x.id));
  const p = n.parentId ? index(map).get(n.parentId) : undefined;
  if (p) p.children = p.children.filter(id => id !== n.id);
  map.nodes = map.nodes.filter(x => !gone.has(x.id));
  return gone.size;
}

function detach(map: MindMap, n: MapNode) {
  const op = n.parentId ? index(map).get(n.parentId) : undefined;
  if (op) op.children = op.children.filter(id => id !== n.id);
}

/** 別の親の下へ移す。中心ノードを移すと、そのマップは移し先の枝になる。 */
export function moveNode(map: MindMap, n: MapNode, newParent: MapNode, { after = null }: { after?: MapNode | null } = {}): void {
  if (subtree(map, n).some(x => x.id === newParent.id)) throw new Error('自分の子孫の下には移せません');
  detach(map, n);
  n.parentId = newParent.id; n.dx = 0; n.dy = 0; delete n.layout;
  if (!newParent.parentId) { n.side = balancedSide(map, newParent); n.colorIndex = nextColor(newParent); }
  newParent.collapsed = false;
  const i = after ? newParent.children.indexOf(after.id) : -1;
  if (i >= 0) newParent.children.splice(i + 1, 0, n.id); else newParent.children.push(n.id);
}

/** 枝を切り離して、独立したマップの中心ノードにする。 */
export function makeRoot(map: MindMap, n: MapNode): void {
  if (!n.parentId) throw new Error(`${n.text} はすでに中心ノードです`);
  const pos = nextRootPos(map);
  detach(map, n);
  Object.assign(n, { parentId: null, side: 'right', colorIndex: 0 }, pos);
  const byId = index(map);
  n.children.forEach((id, i) => Object.assign(byId.of(id), { side: i % 2 ? 'left' : 'right', colorIndex: i % 8 }));
}

/** 階層つきの箇条書きにする。withIds なら ID と状態も付ける。
 * ID なしでマップ全体を書くときは、中心ノードごとに「# 見出し」を立てる。 */
export function outline(map: MindMap, { withIds = false, from = null }: { withIds?: boolean; from?: MapNode | null } = {}): string {
  const byId = index(map);
  const lines: string[] = [];
  const walk = (n: MapNode, depth: number) => {
    let line = '  '.repeat(depth) + '- ' + n.text;
    if (withIds) {
      const marks: string[] = [];
      if (!n.parentId) marks.push('中心', '配置:' + LAYOUTS[layoutOf(n)]);
      if (n.collapsed) marks.push(`折りたたみ:${subtree(map, n).length - 1}`);
      line += `  (${n.id}${marks.length ? ' ' + marks.join(' ') : ''})`;
    }
    lines.push(line);
    for (const id of n.children) walk(byId.of(id), depth + 1);
  };
  for (const start of from ? [from] : roots(map)) {
    if (!start.parentId && !withIds) {
      if (lines.length) lines.push('');
      lines.push('# ' + start.text);
      for (const id of start.children) walk(byId.of(id), 0);
    } else walk(start, 0);
  }
  return lines.join('\n') + '\n';
}

/** Markdown の箇条書きを {text, children} の木の並びに読む。
 * 「# 見出し」はその下の箇条書きを子に持つ木になる。見出しの前の箇条書きは最上位の項目がそれぞれ木になる。
 * headed は見出しがあったかどうか。 */
export function parseOutline(text: string): { trees: OutlineItem[]; headed: boolean } {
  const trees: OutlineItem[] = [];
  let headed = false;
  let stack: { indent: number; children: OutlineItem[] }[] = [{ indent: -1, children: trees }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const h = raw.match(/^#\s+(.+?)\s*$/);
    if (h) {
      const item: OutlineItem = { text: h[1], children: [] };
      trees.push(item); headed = true;
      stack = [{ indent: -1, children: item.children }];
      continue;
    }
    const m = raw.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*?)\s*$/);
    if (!m) throw new Error(`箇条書きとして読めない行があります: ${raw}`);
    const indent = m[1].replace(/\t/g, '    ').length;
    const item: OutlineItem = { text: m[2], children: [] };
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].children.push(item);
    stack.push({ indent, children: item.children });
  }
  return { trees, headed };
}

export function addTree(map: MindMap, parent: MapNode, items: OutlineItem[]): number {
  let count = 0;
  for (const it of items) {
    const n = addChild(map, parent, it.text);
    count += 1 + addTree(map, n, it.children);
  }
  return count;
}

/** 木の並びを、それぞれ独立したマップとして足す。 */
export function addRoots(map: MindMap, trees: OutlineItem[]): number {
  let count = 0;
  for (const t of trees) count += 1 + addTree(map, addRoot(map, t.text), t.children);
  return count;
}
