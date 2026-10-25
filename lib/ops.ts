// 名前・ID・経路で指した操作を、マップ1つに当てる。Durable Object が書き込みのたびに呼ぶ。
// 名前の解決も同じ場所で行うので、解決と書き込みの間に別の書き込みが割り込まない。
import { roots, resolve, pathOf, addChild, addRoot, removeNode, moveNode, makeRoot, setLayout, setSide, LAYOUTS,
  parseOutline, addTree, addRoots, subtree } from './map.ts';
import type { MindMap, MapNode } from './map.ts';

export const OPS = ['add', 'rename', 'move', 'remove', 'layout', 'side', 'collapse', 'expand', 'import'] as const;
export type OpName = typeof OPS[number];

/** 操作の引数。CLI のオプションと同じ名前にしてある。 */
export interface OpArgs {
  text?: string;
  node?: string;
  under?: string;
  after?: string;
  root?: boolean;
  replace?: boolean;
  mode?: string;
  side?: string;
}
export interface OpResult {
  message: string;
  /** 主に動いたノード。 */
  id?: string;
  /** import --replace で作り直したときの新しいマップ。 */
  map?: MindMap;
}

function need<T>(v: T | undefined | null | '', what: string): T {
  if (v === undefined || v === null || v === '') throw new Error(`${what} が必要です`);
  return v;
}

/** --under を省いたときの親。中心ノードが1つならそれ、複数なら指定を求める。 */
function defaultParent(map: MindMap): MapNode {
  const rs = roots(map);
  if (rs.length === 1) return rs[0];
  throw new Error('中心ノードが複数あります。--under で親を指定するか、--root で新しいマップにしてください: '
    + rs.map(r => `${r.text}（${r.id}）`).join(', '));
}

function afterOf(map: MindMap, a: OpArgs, parent: MapNode): MapNode | null {
  const after = a.after ? resolve(map, a.after) : null;
  if (after && after.parentId !== parent.id) throw new Error('--after のノードは --under の子ではありません');
  return after;
}

/** map を直接書き換え、結果の文を返す。map が null でよいのは import --replace だけ。 */
export function applyOp(map: MindMap | null, op: string, a: OpArgs = {}): OpResult {
  if (op === 'import' && a.replace) {
    const { trees } = parseOutline(String(need(a.text, '箇条書き')));
    if (!trees.length) throw new Error('取り込む項目がありません');
    const fresh: MindMap = { uid: 1, nodes: [] };
    const count = addRoots(fresh, trees);
    return { message: `取り込み: ${count} 件 → 新しい中心ノード`, map: fresh };
  }
  if (!map) throw new Error('マップがありません');
  switch (op) {
    case 'add': {
      const text = need(a.text, '文字');
      if (a.root) {
        const n = addRoot(map, text);
        return { message: `追加: ${n.text} (${n.id}) を新しい中心ノードとして`, id: n.id };
      }
      const parent = a.under ? resolve(map, a.under) : defaultParent(map);
      const n = addChild(map, parent, text, { after: afterOf(map, a, parent) });
      return { message: `追加: ${n.text} (${n.id}) ← ${pathOf(map, parent)}`, id: n.id };
    }
    case 'rename': {
      const n = resolve(map, need(a.node, 'ノード'));
      const text = need(a.text, '新しい文字');
      const before = n.text; n.text = text;
      return { message: `改名: ${before} → ${n.text} (${n.id})`, id: n.id };
    }
    case 'move': {
      const n = resolve(map, need(a.node, 'ノード'));
      if (a.root) {
        makeRoot(map, n);
        return { message: `切り離し: ${n.text} (${n.id}) を独立したマップに`, id: n.id };
      }
      const parent = resolve(map, need(a.under, '--under か --root'));
      moveNode(map, n, parent, { after: afterOf(map, a, parent) });
      return { message: `移動: ${n.text} (${n.id}) → ${pathOf(map, parent)} の下`, id: n.id };
    }
    case 'remove': {
      const n = resolve(map, need(a.node, 'ノード'));
      const count = removeNode(map, n);
      return { message: `削除: ${n.text} (${n.id}) と子孫、合わせて ${count} 件`, id: n.id };
    }
    case 'layout': {
      const n = resolve(map, need(a.node, '中心ノード'));
      setLayout(map, n, need(a.mode, '配置（both / right / left）'));
      return { message: `配置: ${n.text} (${n.id}) を${LAYOUTS[n.layout ?? 'both']}に`, id: n.id };
    }
    case 'side': {
      const n = resolve(map, need(a.node, 'ノード'));
      const b = setSide(map, n, need(a.side, '向き（left / right）'));
      return { message: `向き: ${b.text} (${b.id}) を${b.side === 'left' ? '左' : '右'}に`, id: b.id };
    }
    case 'collapse':
    case 'expand': {
      const n = resolve(map, need(a.node, 'ノード'));
      n.collapsed = op === 'collapse';
      return { message: `${op === 'collapse' ? '折りたたみ' : '展開'}: ${n.text} (${n.id})、子孫 ${subtree(map, n).length - 1} 件`, id: n.id };
    }
    case 'import': {
      const { trees, headed } = parseOutline(String(need(a.text, '箇条書き')));
      if (a.root || (!a.under && headed)) {
        const count = addRoots(map, trees);
        return { message: `取り込み: ${count} 件 → 新しい中心ノード` };
      }
      const parent = a.under ? resolve(map, a.under) : defaultParent(map);
      const count = addTree(map, parent, trees);
      return { message: `取り込み: ${count} 件 → ${pathOf(map, parent)} の下` };
    }
    default:
      throw new Error(`知らない操作です: ${op}`);
  }
}
