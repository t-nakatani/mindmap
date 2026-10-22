#!/usr/bin/env node
// マインドマップを名前指定で操作する CLI。正本の data/<マップ名>.json を直接書き換える。
// サーバーが動いていれば、ページには自動で反映される。
import fs from 'node:fs';
import { readMap, writeMap, newMap, roots, resolve, pathOf, addChild, addRoot, removeNode, moveNode, makeRoot, setLayout, setSide, LAYOUTS,
  outline, parseOutline, addTree, addRoots, subtree, DATA_DIR, listMaps, currentName, setCurrent, mapExists, cleanName } from './lib/map.mjs';

const USAGE = `使い方: node cli.mjs <コマンド> [引数] [オプション]

  maps                                 マップ（ファイル）の一覧。* が今選んでいるもの
  use <マップ名>                       操作と画面の対象にするマップを切り替える
  new <題名> --map <マップ名>          新しいマップ（ファイル）を作る。切り替えは use で
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

どのコマンドも --map <マップ名> で対象のマップを変えられる（省くと use で選んだもの）。
中心ノードは複数置ける。それぞれが独立したマップになる。
--under を省くと、中心ノードが1つのときはその下に入る。複数あるときは --under か --root が必要。
ノードの指定: ID（n12）、完全一致の名前、または「中心/予算/人件費」のような経路（中心は省ける）。
名前が複数あるときは ID か経路で指定する。
マップの置き場: 環境変数 MINDMAP_DIR（既定は data/）。既定のマップ名: 環境変数 MINDMAP_MAP か data/.current`;

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--under' || a === '--after' || a === '--map') opt[a.slice(2)] = argv[++i];
    else if (a === '--replace' || a === '--root' || a === '--help' || a === '-h') opt[a.replace(/^-+/, '')] = true;
    else pos.push(a);
  }
  return { pos, opt };
}

function need(v, what) { if (v === undefined || v === '') throw new Error(`${what} が必要です`); return v; }

/** --under を省いたときの親。中心ノードが1つならそれ、複数なら指定を求める。 */
function defaultParent(map) {
  const rs = roots(map);
  if (rs.length === 1) return rs[0];
  throw new Error('中心ノードが複数あります。--under で親を指定するか、--root で新しいマップにしてください: '
    + rs.map(r => `${r.text}（${r.id}）`).join(', '));
}

function main() {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || opt.help) { console.log(USAGE); return; }

  if (cmd === 'maps') {
    const cur = currentName();
    const all = listMaps();
    if (!all.length) { console.log(`マップがありません（${DATA_DIR}）。new <題名> --map <マップ名> で作ってください`); return; }
    const fmt = iso => { const d = new Date(iso), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
    for (const m of all) console.log(`${m.name === cur ? '*' : ' '} ${m.name}\t${m.title}\t中心 ${m.roots} 件\t${fmt(m.updatedAt)}`);
    return;
  }
  if (cmd === 'use') {
    const n = setCurrent(need(pos[1], 'マップ名'));
    console.log(`選択: ${n}（画面も切り替わります）`);
    return;
  }

  // 対象のマップ名。--map、環境変数、use で選んだもの、の順。
  let mapName = opt.map ? cleanName(opt.map) : (process.env.MINDMAP_MAP ? cleanName(process.env.MINDMAP_MAP) : currentName());

  if (cmd === 'new') {
    const title = need(pos[1], '題名');
    if (opt.map && mapExists(mapName) && !opt.replace) throw new Error(`マップ「${mapName}」はもうあります。別の名前にするか、作り直すなら --replace を付けてください`);
    if (!mapName) mapName = 'map';
    const map = newMap(title);
    writeMap(map, mapName);
    if (!currentName()) setCurrent(mapName);
    console.log(`マップ「${mapName}」を作りました: ${map.nodes[0].text} (${map.nodes[0].id})`
      + (currentName() !== mapName ? `。画面に出すには: node cli.mjs use ${mapName}` : ''));
    return;
  }

  let map = readMap(mapName);
  if (!map) {
    if (cmd === 'import' && opt.replace) { map = { uid: 1, nodes: [] }; if (!mapName) mapName = 'map'; }
    else if (!mapName) throw new Error(`マップがありません（${DATA_DIR}）。new <題名> --map <マップ名> で作ってください`);
    else throw new Error(`マップ「${mapName}」がありません。maps で一覧を見るか、new <題名> --map ${mapName} で作ってください`);
  }

  switch (cmd) {
    case 'show': {
      const from = pos[1] ? resolve(map, pos[1]) : null;
      process.stdout.write(outline(map, { withIds: true, from }));
      return;
    }
    case 'export': {
      const from = pos[1] ? resolve(map, pos[1]) : null;
      process.stdout.write(outline(map, { from }));
      return;
    }
    case 'add': {
      const text = need(pos[1], '文字');
      if (opt.root) {
        const n = addRoot(map, text);
        writeMap(map, mapName);
        console.log(`追加: ${n.text} (${n.id}) を新しい中心ノードとして`);
        return;
      }
      const parent = opt.under ? resolve(map, opt.under) : defaultParent(map);
      const after = opt.after ? resolve(map, opt.after) : null;
      if (after && after.parentId !== parent.id) throw new Error('--after のノードは --under の子ではありません');
      const n = addChild(map, parent, text, { after });
      writeMap(map, mapName);
      console.log(`追加: ${n.text} (${n.id}) ← ${pathOf(map, parent)}`);
      return;
    }
    case 'rename': {
      const n = resolve(map, need(pos[1], 'ノード'));
      const text = need(pos[2], '新しい文字');
      const before = n.text; n.text = text;
      writeMap(map, mapName);
      console.log(`改名: ${before} → ${n.text} (${n.id})`);
      return;
    }
    case 'move': {
      const n = resolve(map, need(pos[1], 'ノード'));
      if (opt.root) {
        makeRoot(map, n);
        writeMap(map, mapName);
        console.log(`切り離し: ${n.text} (${n.id}) を独立したマップに`);
        return;
      }
      const parent = resolve(map, need(opt.under, '--under か --root'));
      const after = opt.after ? resolve(map, opt.after) : null;
      if (after && after.parentId !== parent.id) throw new Error('--after のノードは --under の子ではありません');
      moveNode(map, n, parent, { after });
      writeMap(map, mapName);
      console.log(`移動: ${n.text} (${n.id}) → ${pathOf(map, parent)} の下`);
      return;
    }
    case 'remove': {
      const n = resolve(map, need(pos[1], 'ノード'));
      const count = removeNode(map, n);
      writeMap(map, mapName);
      console.log(`削除: ${n.text} (${n.id}) と子孫、合わせて ${count} 件`);
      return;
    }
    case 'layout': {
      const n = resolve(map, need(pos[1], '中心ノード'));
      setLayout(map, n, need(pos[2], '配置（both / right / left）'));
      writeMap(map, mapName);
      console.log(`配置: ${n.text} (${n.id}) を${LAYOUTS[n.layout]}に`);
      return;
    }
    case 'side': {
      const n = resolve(map, need(pos[1], 'ノード'));
      const b = setSide(map, n, need(pos[2], '向き（left / right）'));
      writeMap(map, mapName);
      console.log(`向き: ${b.text} (${b.id}) を${b.side === 'left' ? '左' : '右'}に`);
      return;
    }
    case 'collapse':
    case 'expand': {
      const n = resolve(map, need(pos[1], 'ノード'));
      n.collapsed = cmd === 'collapse';
      writeMap(map, mapName);
      console.log(`${cmd === 'collapse' ? '折りたたみ' : '展開'}: ${n.text} (${n.id})、子孫 ${subtree(map, n).length - 1} 件`);
      return;
    }
    case 'import': {
      const src = need(pos[1], 'ファイル');
      const text = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8');
      const { trees, headed } = parseOutline(text);
      let count, where;
      if (opt.replace || opt.root || (!opt.under && headed)) {
        if (opt.replace) {
          if (!trees.length) throw new Error('取り込む項目がありません');
          map = { uid: 1, nodes: [] };
        }
        count = addRoots(map, trees); where = '新しい中心ノード';
      } else {
        const parent = opt.under ? resolve(map, opt.under) : defaultParent(map);
        count = addTree(map, parent, trees); where = pathOf(map, parent) + ' の下';
      }
      writeMap(map, mapName);
      console.log(`取り込み: ${count} 件 → ${where}`);
      return;
    }
    default:
      throw new Error(`知らないコマンドです: ${cmd}\n\n${USAGE}`);
  }
}

try { main(); } catch (e) { console.error('エラー: ' + (e.message || e)); process.exit(1); }
