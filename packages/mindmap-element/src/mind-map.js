// <mind-map>: どのページにも置けるマインドマップの部品。
// 描画と操作だけを持ち、保存先もログインも知らない。データは外から渡す store を通して読み書きする。
//
//   import { defineMindMap, httpStore } from '@t-nakatani/mindmap-element';
//   defineMindMap();                                  // <mind-map> を登録する
//   const el = document.querySelector('mind-map');
//   el.store = httpStore({ base: '/api/mindmap', name: 'daily-2026-11-27' });
//
// store の決まり（MindMapStore）:
//   load(): Promise<{ map, version } | null>          null なら空のマップを作り、最初の save で保存する
//   save(map, baseVersion): Promise<{ ok: true, version } | { conflict: true, map, version } | { error }>
//   subscribe?(cb: ({ map, version }) => void): () => void   ほかの場所での変更を受ける
//   unfurl?(url): Promise<{ ok, title, site, description, image, icon } | null>   リンクの題名など
// 属性: readonly（閲覧のみ）、root-title（空のマップの中心ノードの文字）
// イベント: mindmap-change（detail: { map }。保存の前に出す）
// 見た目は CSS 変数（--color-*・--space-*・--radius-*）で外から変えられる。値は Figma「Mind Map — UI」の変数と同じ。
//
// 中身は mindmap 本体の public/index.html から切り出したもの。本体が部品に置き換わるまでは両方を直す。

const CSS = "  /* 色・余白・角丸・影は Figma「Mind Map — UI」の変数と同じ名前にしてある（Foundations ページ）。\n     値を変えるときは Figma の変数を先に変え、ここへ写す。 */\n  :host {\n    color-scheme: light;\n    --color-bg-canvas: #f5f4f0;\n    --color-bg-node: #ffffff;\n    --color-bg-panel: rgba(255, 255, 255, 0.88);\n    --color-bg-popover: #ffffff;\n    --color-bg-control: #ffffff;\n    --color-bg-hover: rgba(0, 0, 0, 0.05);\n    --color-bg-segment: rgba(0, 0, 0, 0.05);\n    --color-bg-segment-active: #ffffff;\n    --color-bg-accent: #2f6feb;\n    --color-bg-accent-subtle: rgba(47, 111, 235, 0.10);\n    --color-bg-board: rgba(0, 0, 0, 0.035);\n    --color-bg-kbd: rgba(127, 127, 127, 0.15);\n    --color-text-primary: #1f2328;\n    --color-text-secondary: #6b7280;\n    --color-text-accent: #2f6feb;\n    --color-text-link: #2f6feb;\n    --color-text-on-accent: #ffffff;\n    --color-text-on-branch: #ffffff;\n    --color-text-danger: #e4572e;\n    --color-border-node: #cfcbc2;\n    --color-border-panel: rgba(0, 0, 0, 0.08);\n    --color-border-control: rgba(0, 0, 0, 0.12);\n    --color-border-board: rgba(0, 0, 0, 0.14);\n    --color-border-accent: #2f6feb;\n    --color-shadow-soft: rgba(0, 0, 0, 0.06);\n    --color-shadow-strong: rgba(0, 0, 0, 0.10);\n    --color-branch-1: #e4572e;\n    --color-branch-2: #e9a21a;\n    --color-branch-3: #3fa34d;\n    --color-branch-4: #1f9e8f;\n    --color-branch-5: #2f6feb;\n    --color-branch-6: #7c5cde;\n    --color-branch-7: #c63fb5;\n    --color-branch-8: #e0456f;\n    --space-2: 2px; --space-4: 4px; --space-6: 6px; --space-8: 8px; --space-12: 12px;\n    --space-16: 16px; --space-20: 20px; --space-24: 24px; --space-32: 32px;\n    --radius-xs: 4px; --radius-sm: 6px; --radius-md: 8px; --radius-node: 10px; --radius-lg: 12px; --radius-xl: 16px; --radius-full: 999px;\n    --size-control: 32px; --size-icon: 16px;\n    --shadow-panel: 0 1px 2px var(--color-shadow-soft), 0 6px 20px var(--color-shadow-soft);\n    --shadow-popover: 0 2px 6px var(--color-shadow-soft), 0 12px 32px var(--color-shadow-strong);\n    --shadow-control: 0 1px 2px var(--color-shadow-strong);\n    --font-sans: -apple-system, BlinkMacSystemFont, \"Hiragino Sans\", \"Noto Sans JP\", \"Helvetica Neue\", sans-serif;\n  }\n  @media (prefers-color-scheme: dark) {\n    :host {\n      color-scheme: dark;\n      --color-bg-canvas: #1b1c20;\n      --color-bg-node: #2a2b31;\n      --color-bg-panel: rgba(32, 33, 38, 0.92);\n      --color-bg-popover: #202126;\n      --color-bg-control: #2a2b31;\n      --color-bg-hover: rgba(255, 255, 255, 0.08);\n      --color-bg-segment: rgba(255, 255, 255, 0.06);\n      --color-bg-segment-active: #383a42;\n      --color-bg-accent: #6ea2ff;\n      --color-bg-accent-subtle: rgba(110, 162, 255, 0.18);\n      --color-bg-board: rgba(255, 255, 255, 0.035);\n      --color-text-primary: #e8e8ea;\n      --color-text-secondary: #9ca3af;\n      --color-text-accent: #6ea2ff;\n      --color-text-link: #6ea2ff;\n      --color-text-on-accent: #1b1c20;\n      --color-text-danger: #f07a57;\n      --color-border-node: #45474f;\n      --color-border-panel: rgba(255, 255, 255, 0.10);\n      --color-border-control: rgba(255, 255, 255, 0.14);\n      --color-border-board: rgba(255, 255, 255, 0.16);\n      --color-border-accent: #6ea2ff;\n      --color-shadow-soft: rgba(0, 0, 0, 0.30);\n      --color-shadow-strong: rgba(0, 0, 0, 0.45);\n    }\n  }\n  :host { display: block; position: relative; overflow: hidden; min-height: 240px; background: var(--color-bg-canvas); color: var(--color-text-primary);\n    font-family: var(--font-sans); font-size: 13px; -webkit-font-smoothing: antialiased; contain: layout paint; }\n  :host(:focus) { outline: none; }\n  [hidden] { display: none !important; }\n  :focus-visible { outline: 2px solid var(--color-border-accent); outline-offset: 2px; }\n\n  /* ---------- キャンバス ---------- */\n  #canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }\n  #canvas.panning { cursor: grabbing; }\n  .node { cursor: default; }\n  .node .body { fill: var(--color-bg-node); stroke: var(--color-border-node); stroke-width: 1.5; transition: stroke .12s; }\n  .node.root .body { stroke-width: 2; }\n  .node .sel-ring { fill: none; stroke: var(--color-border-accent); stroke-width: 2; display: none; }\n  .node.selected .sel-ring { display: block; }\n  .node.drop-target .body { stroke: var(--color-border-accent) !important; stroke-width: 2.5; stroke-dasharray: 6 4; }\n  .node.dragging { opacity: .4; }\n  #insert-line { stroke: var(--color-border-accent); stroke-width: 4; stroke-linecap: round; display: none; }\n  /* ⇧ ドラッグの範囲選択の枠 */\n  #marquee { fill: var(--color-bg-accent-subtle); stroke: var(--color-border-accent); stroke-width: 1; vector-effect: non-scaling-stroke; display: none; pointer-events: none; }\n  #canvas.selecting { cursor: crosshair; }\n  .node text { fill: var(--color-text-primary); font-size: 15px; pointer-events: none; user-select: none; font-family: var(--font-sans); }\n  .node.root text { font-size: 18px; font-weight: 600; }\n  .node.editing .label, .node.editing .link-title { visibility: hidden; }\n  /* リンクのノード（Figma: Node / Type=Link）。サイトのアイコン・題名・↗ の1行。高さはふつうのノードと同じ */\n  .node:not(.is-link) .link-parts, .node.is-link .label { display: none; }\n  .node .fav-globe { color: var(--color-text-secondary); }\n  .node .fav-globe, .node .link-open use { fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }\n  .node .link-open { color: var(--color-text-link); cursor: pointer; }\n  .node .link-open:hover use { stroke-width: 2.25; }\n  .node.hidden, .link.hidden { display: none; }\n  .toggle { cursor: pointer; }\n  .toggle rect { fill: var(--color-bg-node); stroke-width: 1.5; }\n  .toggle text { font-size: 11px; font-weight: 700; pointer-events: none; user-select: none; fill: var(--color-text-on-branch); }\n  .toggle .dash { stroke-width: 2; stroke-linecap: round; }\n  .node:not(.collapsed) .toggle { opacity: 0; transition: opacity .12s; }\n  .node:not(.collapsed):hover .toggle, .node:not(.collapsed).selected .toggle { opacity: 1; }\n  .node.collapsed .toggle rect { fill: var(--toggle-fill); }\n  .link { fill: none; stroke-linecap: round; }\n  .board-rect { fill: var(--color-bg-board); stroke: var(--color-border-board); stroke-width: 1.5; vector-effect: non-scaling-stroke; }\n  .board.selected .board-rect { stroke: var(--color-border-accent); stroke-width: 2; }\n  .board-title { cursor: move; }\n  .board-title rect { fill: var(--color-bg-node); stroke: var(--color-border-node); stroke-width: 1; }\n  .board.selected .board-title rect { stroke: var(--color-border-accent); }\n  .board-title text { fill: var(--color-text-primary); font-size: 13px; font-weight: 600; pointer-events: none; user-select: none; font-family: var(--font-sans); }\n  .board.editing .board-title { visibility: hidden; }\n  .board-handle { fill: var(--color-bg-node); stroke: var(--color-border-accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }\n  .board-handle[data-corner=\"nw\"], .board-handle[data-corner=\"se\"] { cursor: nwse-resize; }\n  .board-handle[data-corner=\"ne\"], .board-handle[data-corner=\"sw\"] { cursor: nesw-resize; }\n  .board:not(.selected) .board-handle, .board.multi .board-handle, :host([readonly]) .board-handle { display: none; }\n  :host([readonly]) .board-title { cursor: default; }\n  #board-editor { position: absolute; left: 0; top: 0; display: none; height: 24px; box-sizing: border-box; padding: 0 8px;\n    border-radius: var(--radius-sm); border: 1px solid var(--color-border-accent); background: var(--color-bg-node); color: var(--color-text-primary); outline: none;\n    font: 600 13px var(--font-sans); }\n  #editor { position: absolute; left: 0; top: 0; transform-origin: 0 0; outline: none; white-space: pre;\n    line-height: 1.2; min-width: 4px; background: transparent; color: var(--color-text-primary); display: none; caret-color: var(--color-border-accent);\n    font-family: var(--font-sans); }\n\n  /* ---------- ツールバー（Figma: Components / ツールバー） ---------- */\n  .toolbar { position: absolute; z-index: 2; display: flex; align-items: center; gap: var(--space-2); padding: var(--space-4); box-sizing: border-box;\n    border-radius: var(--radius-lg); background: var(--color-bg-panel); border: 1px solid var(--color-border-panel);\n    box-shadow: var(--shadow-panel); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }\n  #nav { left: 16px; top: 16px; max-width: calc(100% - 32px - 140px); }\n  #actions { right: 16px; top: 16px; }\n  #dock { position: absolute; z-index: 2; left: 16px; right: 16px; bottom: 16px; display: grid; grid-template-columns: 1fr auto 1fr;\n    align-items: end; gap: var(--space-8); pointer-events: none; }\n  #dock > .toolbar { position: static; pointer-events: auto; }\n  #edit-bar { grid-column: 2; }\n  #zoom-bar { grid-column: 3; justify-self: end; }\n  :host([readonly]) .edit-only { display: none !important; }\n\n  .btn, .icon-btn { height: var(--size-control); box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: var(--space-6);\n    padding: 0 10px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-primary);\n    font: 400 13px/18px var(--font-sans); white-space: nowrap; cursor: pointer; text-decoration: none; flex: none; }\n  .btn:hover, .icon-btn:hover { background: var(--color-bg-hover); }\n  .btn:disabled, .icon-btn:disabled { opacity: .4; cursor: default; background: transparent; }\n  .btn-outline { background: var(--color-bg-control); box-shadow: inset 0 0 0 1px var(--color-border-control); }\n  .btn-primary { background: var(--color-bg-accent); color: var(--color-text-on-accent); font-weight: 500; }\n  .btn-primary:hover { background: var(--color-bg-accent); opacity: .9; }\n  .icon-btn { width: var(--size-control); padding: 0; }\n  .icon-btn[aria-expanded=\"true\"] { background: var(--color-bg-accent-subtle); color: var(--color-text-accent); }\n  .icon { width: var(--size-icon); height: var(--size-icon); flex: none; fill: none; stroke: currentColor; stroke-width: 1.75;\n    stroke-linecap: round; stroke-linejoin: round; }\n  .mark { display: inline-flex; padding: 0 2px 0 6px; flex: none; }\n  .mark svg { width: 24px; height: 24px; }\n  .select-wrap { position: relative; display: inline-flex; min-width: 0; }\n  .select-wrap .icon { position: absolute; right: 8px; top: 8px; pointer-events: none; color: var(--color-text-secondary); }\n  .select { appearance: none; -webkit-appearance: none; height: var(--size-control); min-width: 0; max-width: 220px; padding: 0 30px 0 10px;\n    border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-primary);\n    font: 500 13px var(--font-sans); text-overflow: ellipsis; cursor: pointer; }\n  .select:hover { background: var(--color-bg-hover); }\n  .select option { color: initial; }\n  .divider { width: 1px; height: 20px; margin: 0 var(--space-4); background: var(--color-border-panel); flex: none; }\n  .group-label { padding: 0 6px 0 4px; color: var(--color-text-secondary); font-size: 12px; white-space: nowrap; }\n  .seg { display: inline-flex; gap: var(--space-2); padding: var(--space-2); border-radius: var(--radius-md); background: var(--color-bg-segment); flex: none; }\n  .seg button { height: 28px; padding: 0 10px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-secondary);\n    font: 400 13px var(--font-sans); white-space: nowrap; cursor: pointer; }\n  .seg button:hover:not(:disabled) { color: var(--color-text-primary); }\n  .seg button.active { background: var(--color-bg-segment-active); color: var(--color-text-primary); font-weight: 500; box-shadow: var(--shadow-control); }\n  .seg button:disabled { opacity: .4; cursor: default; }\n  #zoom { width: 48px; text-align: center; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; flex: none; }\n  .badge { display: inline-flex; align-items: center; gap: var(--space-4); height: 24px; margin: 0 var(--space-4); padding: 0 10px 0 8px;\n    border-radius: var(--radius-full); background: var(--color-bg-hover); color: var(--color-text-secondary); font-size: 12px; white-space: nowrap; }\n  .badge .icon { width: 14px; height: 14px; }\n\n  /* ---------- パネル（Figma: Components / パネル） ---------- */\n  .popover { position: absolute; z-index: 3; right: 16px; top: 66px; display: none; flex-direction: column; gap: var(--space-12);\n    width: min(380px, calc(100% - 32px)); max-height: calc(100% - 66px - 80px); overflow: auto; box-sizing: border-box; padding: var(--space-8) var(--space-16) var(--space-16);\n    border-radius: var(--radius-lg); background: var(--color-bg-popover); border: 1px solid var(--color-border-panel); box-shadow: var(--shadow-popover); }\n  .popover.show { display: flex; }\n  .popover-header { display: flex; align-items: center; justify-content: space-between; margin-right: calc(-1 * var(--space-8)); }\n  .popover h2 { margin: 0; font-size: 13px; font-weight: 600; }\n  .popover h3 { margin: 0 0 var(--space-6); font-size: 12px; font-weight: 400; color: var(--color-text-secondary); }\n  .popover p { margin: 0; color: var(--color-text-secondary); font-size: 12px; line-height: 18px; }\n  .keys { display: grid; grid-template-columns: 116px 1fr; gap: var(--space-6) var(--space-12); margin: 0; }\n  .keys dt { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-start; }\n  .keys dd { margin: 0; font-size: 12px; line-height: 20px; }\n  kbd { display: inline-block; min-width: 8px; padding: 2px 6px; border-radius: var(--radius-xs); background: var(--color-bg-kbd);\n    color: var(--color-text-primary); font: 500 11px/16px var(--font-sans); text-align: center; white-space: nowrap; }\n  #account { display: flex; align-items: center; justify-content: space-between; gap: var(--space-8); padding-top: var(--space-8);\n    border-top: 1px solid var(--color-border-panel); color: var(--color-text-secondary); font-size: 12px; }\n  #account > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n  #share-panel { width: min(340px, calc(100% - 32px)); }\n  /* マップの一覧（Figma: Panel/Maps・Map row）。左上のマップ名（Select）の下に出す */\n  #map-btn { min-width: 0; max-width: 260px; padding: 0 var(--space-8) 0 10px; font-weight: 500; }\n  #map-btn-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }\n  #map-btn .icon { color: var(--color-text-secondary); }\n  #map-btn[aria-expanded=\"true\"], #map-btn[aria-expanded=\"true\"] .icon { background: var(--color-bg-accent-subtle); color: var(--color-text-accent); }\n  #map-btn[aria-expanded=\"true\"] .icon { background: transparent; }\n  #map-menu { left: 16px; right: auto; top: 66px; width: min(380px, calc(100% - 32px)); padding: var(--space-8); gap: var(--space-4); }\n  .menu-search { position: relative; display: flex; margin-bottom: var(--space-4); }\n  .menu-search .icon { position: absolute; left: 10px; top: 8px; color: var(--color-text-secondary); pointer-events: none; }\n  .menu-search .input { padding-left: 34px; }\n  #map-list { display: flex; flex-direction: column; gap: var(--space-2); overflow: auto; max-height: min(420px, calc(100vh - 220px)); }\n  .map-row { display: flex; align-items: center; gap: var(--space-8); min-height: 44px; box-sizing: border-box;\n    padding: var(--space-4) var(--space-4) var(--space-4) var(--space-8); border-radius: var(--radius-md); cursor: pointer; }\n  .map-row.active, .map-row.editing, .map-row.confirming { background: var(--color-bg-hover); }\n  .map-row.editing, .map-row.confirming { cursor: default; }\n  .map-row:not(.editing) { user-select: none; }\n  #map-list.reordering, #map-list.reordering .map-row { cursor: grabbing; }\n  .map-row > .icon { color: var(--color-text-accent); visibility: hidden; }\n  .map-row.current > .icon { visibility: visible; }\n  .map-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }\n  .map-name, .map-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n  .map-name { font-size: 13px; line-height: 18px; font-weight: 500; }\n  .map-row.current .map-name { color: var(--color-text-accent); }\n  .map-sub { color: var(--color-text-secondary); font-size: 12px; line-height: 16px; }\n  .map-sub:empty { display: none; }\n  .map-actions { display: none; gap: var(--space-2); }\n  .map-row.active .map-actions, .map-row:focus-within .map-actions { display: flex; }\n  .map-actions .icon-btn { color: var(--color-text-secondary); }\n  .map-actions .icon-btn:hover { color: var(--color-text-primary); }\n  .btn-danger, .btn-danger:hover { color: var(--color-text-danger); font-weight: 500; }\n  .menu-empty { padding: var(--space-12) var(--space-8); color: var(--color-text-secondary); font-size: 12px; }\n  #map-footer { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-border-panel); }\n  #map-footer .btn { width: 100%; justify-content: flex-start; padding: 0 var(--space-8); }\n  #map-footer .map-row { min-height: var(--size-control); padding: 0 0 0 var(--space-8); }\n  #map-footer .map-row > .icon { visibility: visible; color: var(--color-text-primary); }\n  /* ノードの右クリックメニュー。項目はボタンを足すだけで増やせる */\n  .context-menu { position: absolute; z-index: 4; display: none; flex-direction: column; min-width: 180px;\n    padding: var(--space-4); border-radius: var(--radius-lg); background: var(--color-bg-popover);\n    border: 1px solid var(--color-border-panel); box-shadow: var(--shadow-popover); }\n  .context-menu.show { display: flex; }\n  .context-menu .btn { width: 100%; justify-content: flex-start; padding: 0 var(--space-8); }\n  /* リンクのパネル（Figma: Panel/Link・Panel/Link edit）。ノードのそばに出すので、位置は transform で決める */\n  #link-panel, #link-edit { left: 0; top: 0; right: auto; z-index: 2; width: min(340px, calc(100% - 16px)); max-height: none;\n    padding: var(--space-12) var(--space-12) var(--space-8); gap: var(--space-8); }\n  #link-edit { padding-bottom: var(--space-12); }\n  .link-preview { display: flex; gap: var(--space-12); }\n  .link-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-4); }\n  .link-site { display: flex; align-items: center; gap: var(--space-6); min-width: 0; color: var(--color-text-secondary); font-size: 12px; line-height: 18px; }\n  .link-site img { width: 16px; height: 16px; border-radius: var(--radius-xs); flex: none; }\n  .link-site span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n  .link-heading, .link-desc { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }\n  .link-heading { font-size: 13px; line-height: 18px; font-weight: 600; }\n  .link-desc { color: var(--color-text-secondary); font-size: 12px; line-height: 18px; }\n  .link-desc:empty { display: none; }\n  .link-thumb { width: 64px; height: 64px; flex: none; border-radius: var(--radius-md); object-fit: cover; background: var(--color-bg-hover); }\n  .link-url { color: var(--color-text-link); font-size: 12px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }\n  .link-url:hover { text-decoration: underline; }\n  .link-actions { display: flex; gap: var(--space-2); padding-top: var(--space-6); border-top: 1px solid var(--color-border-panel); }\n  .link-edit-actions { display: flex; justify-content: flex-end; gap: var(--space-8); }\n  #share-list { display: flex; flex-direction: column; gap: var(--space-2); }\n  #share-list .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-8); }\n  #share-list .row span { overflow: hidden; text-overflow: ellipsis; }\n  #share-form { display: flex; gap: var(--space-8); }\n  .input { flex: 1; min-width: 0; height: var(--size-control); box-sizing: border-box; padding: 0 10px; border: 0; border-radius: var(--radius-md);\n    background: var(--color-bg-control); box-shadow: inset 0 0 0 1px var(--color-border-control); color: var(--color-text-primary); font: 400 13px var(--font-sans); }\n  .input::placeholder { color: var(--color-text-secondary); }\n  .input:focus { outline: 2px solid var(--color-border-accent); outline-offset: 1px; }\n  .error { color: var(--color-text-danger); font-size: 12px; line-height: 18px; }\n  .error:empty { display: none; }\n\n  /* ---------- ログイン（Figma: Card/Login） ---------- */\n  #login { position: fixed; inset: 0; z-index: 10; display: none; align-items: center; justify-content: center; background: var(--color-bg-canvas); }\n  #login.show { display: flex; }\n  .login-card { display: flex; flex-direction: column; align-items: center; gap: var(--space-12); width: min(320px, calc(100% - 32px)); box-sizing: border-box;\n    padding: var(--space-32) var(--space-32) var(--space-24); border-radius: var(--radius-xl); background: var(--color-bg-popover);\n    border: 1px solid var(--color-border-panel); box-shadow: var(--shadow-popover); text-align: center; }\n  .login-card svg { width: 40px; height: 40px; }\n  .login-card h1 { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }\n  .login-card p { margin: 0; color: var(--color-text-secondary); font-size: 12px; }\n  .login-card .btn { align-self: stretch; }\n\n  /* ---------- 狭い画面（Figma: Canvas / Mobile） ---------- */\n  @media (max-width: 880px) {\n    #dock { left: 12px; right: 12px; bottom: 12px; display: flex; flex-direction: column; align-items: flex-end; }\n    #zoom-bar { order: 1; }\n    #edit-bar { order: 2; align-self: stretch; overflow-x: auto; scrollbar-width: none; }\n    #edit-bar::-webkit-scrollbar { display: none; }\n    #nav { left: 12px; top: 12px; max-width: calc(100% - 24px - 128px); }\n    #actions { right: 12px; top: 12px; }\n    .popover { right: 12px; top: 62px; width: calc(100% - 24px); }\n    #map-menu { left: 12px; right: 12px; width: auto; }\n    .select { max-width: 160px; }\n  }";
const MARKUP = "<svg width=\"0\" height=\"0\" style=\"position: absolute\" aria-hidden=\"true\">\n  <symbol id=\"i-chevron-down\" viewBox=\"0 0 16 16\"><path d=\"M4 6l4 4 4-4\"/></symbol>\n  <symbol id=\"i-plus\" viewBox=\"0 0 16 16\"><path d=\"M8 3v10M3 8h10\"/></symbol>\n  <symbol id=\"i-minus\" viewBox=\"0 0 16 16\"><path d=\"M3 8h10\"/></symbol>\n  <symbol id=\"i-fit\" viewBox=\"0 0 16 16\"><path d=\"M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4\"/></symbol>\n  <symbol id=\"i-help\" viewBox=\"0 0 16 16\"><circle cx=\"8\" cy=\"8\" r=\"6.25\"/><path d=\"M6.25 6.3a1.8 1.8 0 0 1 3.5.6c0 1.2-1.75 1.5-1.75 2.6M8 11.6v.01\"/></symbol>\n  <symbol id=\"i-share\" viewBox=\"0 0 16 16\"><circle cx=\"6\" cy=\"5.5\" r=\"2.5\"/><path d=\"M1.75 13.5c.6-2.2 2.2-3.4 4.25-3.4s3.65 1.2 4.25 3.4M10.5 3.1a2.5 2.5 0 0 1 0 4.8M12 10.4c1.1.5 1.9 1.5 2.25 3.1\"/></symbol>\n  <symbol id=\"i-file-plus\" viewBox=\"0 0 16 16\"><path d=\"M9 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.75zM9 1.75v4h4M8 7.5v4M6 9.5h4\"/></symbol>\n  <symbol id=\"i-board\" viewBox=\"0 0 16 16\"><rect x=\"2\" y=\"2.5\" width=\"12\" height=\"11\" rx=\"2\" stroke-dasharray=\"2.5 2\"/><path d=\"M4.5 5.25h4\"/></symbol>\n  <symbol id=\"i-close\" viewBox=\"0 0 16 16\"><path d=\"M4 4l8 8M12 4l-8 8\"/></symbol>\n  <symbol id=\"i-link\" viewBox=\"0 0 16 16\"><path d=\"M6.6 9.4l2.8-2.8M7.2 4.6l.9-.9a2.75 2.75 0 0 1 3.9 3.9l-.9.9M8.8 11.4l-.9.9a2.75 2.75 0 0 1-3.9-3.9l.9-.9\"/></symbol>\n  <symbol id=\"i-unlink\" viewBox=\"0 0 16 16\"><path d=\"M7.2 4.6l.9-.9a2.75 2.75 0 0 1 3.9 3.9l-.9.9M8.8 11.4l-.9.9a2.75 2.75 0 0 1-3.9-3.9l.9-.9M2.5 2.5l11 11\"/></symbol>\n  <symbol id=\"i-external\" viewBox=\"0 0 16 16\"><path d=\"M9.5 2.5h4v4M13.5 2.5L8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3\"/></symbol>\n  <symbol id=\"i-globe\" viewBox=\"0 0 16 16\"><circle cx=\"8\" cy=\"8\" r=\"6.25\"/><path d=\"M1.75 8h12.5M8 1.75c1.7 1.7 2.6 3.8 2.6 6.25S9.7 12.55 8 14.25C6.3 12.55 5.4 10.45 5.4 8S6.3 3.45 8 1.75z\"/></symbol>\n  <symbol id=\"i-edit\" viewBox=\"0 0 16 16\"><path d=\"M10.6 2.6l2.8 2.8L6 12.8H3.2V10z\"/></symbol>\n  <symbol id=\"i-check\" viewBox=\"0 0 16 16\"><path d=\"M3.5 8.5l3 3 6-7\"/></symbol>\n  <symbol id=\"i-trash\" viewBox=\"0 0 16 16\"><path d=\"M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.6 8.6a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.6M6.75 6.75v4.5M9.25 6.75v4.5\"/></symbol>\n  <symbol id=\"i-search\" viewBox=\"0 0 16 16\"><circle cx=\"7\" cy=\"7\" r=\"4.25\"/><path d=\"M10.25 10.25l3.25 3.25\"/></symbol>\n  <symbol id=\"i-eye\" viewBox=\"0 0 16 16\"><path d=\"M1.75 8S4 3.5 8 3.5 14.25 8 14.25 8 12 12.5 8 12.5 1.75 8 1.75 8z\"/><circle cx=\"8\" cy=\"8\" r=\"2\"/></symbol>\n  <symbol id=\"i-logo\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"16\" fill=\"#24262d\"/><g fill=\"none\" stroke-width=\"5\" stroke-linecap=\"round\"><path d=\"M28 32H22Q16 32 16 24V18H12\" stroke=\"#e9a21a\"/><path d=\"M36 32H42Q48 32 48 24V16H52\" stroke=\"#3fa34d\"/><path d=\"M36 32H42Q48 32 48 40V48H52\" stroke=\"#7c5cde\"/><path d=\"M28 32H22Q16 32 16 40V46H12\" stroke=\"#e4572e\"/></g><rect x=\"6\" y=\"12\" width=\"14\" height=\"10\" rx=\"4\" fill=\"#e9a21a\"/><rect x=\"44\" y=\"10\" width=\"14\" height=\"10\" rx=\"4\" fill=\"#3fa34d\"/><rect x=\"44\" y=\"44\" width=\"14\" height=\"10\" rx=\"4\" fill=\"#7c5cde\"/><rect x=\"6\" y=\"42\" width=\"14\" height=\"10\" rx=\"4\" fill=\"#e4572e\"/><rect x=\"22\" y=\"22\" width=\"20\" height=\"20\" rx=\"7\" fill=\"#6ea2ff\" stroke=\"#24262d\" stroke-width=\"3\"/></symbol>\n</svg>\n<svg id=\"canvas\" xmlns=\"http://www.w3.org/2000/svg\">\n  <g id=\"world\">\n    <g id=\"boards\"></g>\n    <g id=\"links\"></g>\n    <g id=\"nodes\"></g>\n    <line id=\"insert-line\"></line>\n    <rect id=\"marquee\"></rect>\n  </g>\n</svg>\n<div id=\"editor\" contenteditable=\"true\" spellcheck=\"false\"></div>\n<input id=\"board-editor\" type=\"text\" spellcheck=\"false\" autocomplete=\"off\">\n<div id=\"dock\">\n  <!-- 下中央: 編集（Figma: Toolbar/Edit） -->\n  <div id=\"edit-bar\" class=\"toolbar edit-only\">\n    <button id=\"btn-add-board\" class=\"btn\" title=\"選択中のマップを囲む。選択がなければ画面の真ん中に置く\"><svg class=\"icon\"><use href=\"#i-board\"/></svg>ボード</button>\n    <button id=\"btn-link\" class=\"btn\" title=\"選択中のノードにリンクを付ける（⌘K）\"><svg class=\"icon\"><use href=\"#i-link\"/></svg>リンク</button>\n    <span class=\"divider\"></span>\n    <span class=\"group-label\">配置</span>\n    <span id=\"layout-group\" class=\"seg\" role=\"group\" aria-label=\"配置\">\n      <button data-layout=\"both\">両側</button><button data-layout=\"right\">右</button><button data-layout=\"left\">左</button>\n    </span>\n    <span class=\"divider\"></span>\n    <span class=\"group-label\">枝</span>\n    <span id=\"side-group\" class=\"seg\" role=\"group\" aria-label=\"枝の向き\">\n      <button data-side=\"left\">◀ 左</button><button data-side=\"right\">右 ▶</button>\n    </span>\n  </div>\n  <!-- 右下: 表示（Figma: Toolbar/Zoom） -->\n  <div id=\"zoom-bar\" class=\"toolbar\">\n    <button id=\"btn-zoom-out\" class=\"icon-btn\" title=\"縮小（⌘−）\" aria-label=\"縮小\"><svg class=\"icon\"><use href=\"#i-minus\"/></svg></button>\n    <span id=\"zoom\">100%</span>\n    <button id=\"btn-zoom-in\" class=\"icon-btn\" title=\"拡大（⌘＋）\" aria-label=\"拡大\"><svg class=\"icon\"><use href=\"#i-plus\"/></svg></button>\n    <span class=\"divider\"></span>\n    <button id=\"btn-fit\" class=\"icon-btn\" title=\"全体を表示（⌘0）\" aria-label=\"全体を表示\"><svg class=\"icon\"><use href=\"#i-fit\"/></svg></button>\n  </div>\n</div>\n\n<div id=\"link-panel\" class=\"popover\" role=\"dialog\" aria-label=\"リンク\">\n  <div class=\"link-preview\">\n    <div class=\"link-text\">\n      <div class=\"link-site\"><img id=\"lp-icon\" alt=\"\" referrerpolicy=\"no-referrer\"><span id=\"lp-site\"></span></div>\n      <div id=\"lp-title\" class=\"link-heading\"></div>\n      <div id=\"lp-desc\" class=\"link-desc\"></div>\n    </div>\n    <img id=\"lp-image\" class=\"link-thumb\" alt=\"\" referrerpolicy=\"no-referrer\">\n  </div>\n  <a id=\"lp-url\" class=\"link-url\" target=\"_blank\" rel=\"noopener noreferrer\"></a>\n  <div class=\"link-actions\">\n    <button id=\"lp-open\" class=\"btn\" type=\"button\" title=\"新しいタブで開く（⌘Enter）\"><svg class=\"icon\"><use href=\"#i-external\"/></svg>開く</button>\n    <button id=\"lp-edit\" class=\"btn edit-only\" type=\"button\" title=\"リンクを直す（⌘K）\"><svg class=\"icon\"><use href=\"#i-edit\"/></svg>編集</button>\n    <button id=\"lp-unlink\" class=\"btn edit-only\" type=\"button\"><svg class=\"icon\"><use href=\"#i-unlink\"/></svg>外す</button>\n  </div>\n</div>\n\n<form id=\"link-edit\" class=\"popover\" role=\"dialog\" aria-label=\"リンクを付ける\">\n  <div class=\"popover-header\">\n    <h2>リンク</h2>\n    <button id=\"le-close\" class=\"icon-btn\" type=\"button\" aria-label=\"閉じる\"><svg class=\"icon\"><use href=\"#i-close\"/></svg></button>\n  </div>\n  <input id=\"le-url\" class=\"input\" type=\"text\" inputmode=\"url\" placeholder=\"https://\" autocomplete=\"off\" spellcheck=\"false\">\n  <p>URL を貼ると、ページの題名とアイコンを読み込んで、ノードに表示します。</p>\n  <div id=\"le-error\" class=\"error\"></div>\n  <div class=\"link-edit-actions\">\n    <button id=\"le-unlink\" class=\"btn\" type=\"button\"><svg class=\"icon\"><use href=\"#i-unlink\"/></svg>外す</button>\n    <button class=\"btn btn-primary\" type=\"submit\">リンクする</button>\n  </div>\n</form>\n<div id=\"node-menu\" class=\"context-menu\" role=\"menu\" aria-label=\"ノード\">\n  <button type=\"button\" class=\"btn\" role=\"menuitem\" data-act=\"collapse-under\">この下をしまう</button>\n</div>";

/** shadow root の中に部品を組み立て、操作の口を返す。 */
function mount(host, root) {
  'use strict';
  const $ = id => root.getElementById(id);
  // shadow DOM の外で受けたイベントの、本当の対象
  const tgt = e => (e.composedPath && e.composedPath()[0]) || e.target;
  let readOnly = host.hasAttribute('readonly');
  const rootTitle = () => host.getAttribute('root-title') || '中心テーマ';
  const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Helvetica Neue", sans-serif';
  // 枝の色。値は CSS の --color-branch-1〜8（Figma の color/branch/1〜8）にあり、ライトとダークで同じ。
  const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map(i => `var(--color-branch-${i})`);
  const MIN_SCALE = 0.1;
  // 大きさは Figma の size/node・size/root・radius/node・radius/lg と同じ。
  const NODE_H = 34, ROOT_H = 46, PAD = 14, ROOT_PAD = 20, HGAP = 56, VGAP = 14, MIN_W = 44;
  const NODE_R = 10, ROOT_R = 12, RING_GAP = 2, TOGGLE_H = 16, TOGGLE_GAP = 4;
  // リンクのノード（Figma: Node / Type=Link・Root link）。高さはふつうのノードと同じで、サイトのアイコン・題名・↗ の1行。
  // 題名は 280px で切る。ドメインはリンクのパネルにだけ出す。
  const LINK_TITLE_MAX = 280;
  const LINK_BOX = { padL: 10, padR: 12, icon: 16, gap: 6, open: 12 };
  const ROOT_LINK_BOX = { padL: 16, padR: 18, icon: 18, gap: 8, open: 14 };
  const linkBox = n => isRoot(n) ? ROOT_LINK_BOX : LINK_BOX;

  const svg = $('canvas');
  const world = $('world');
  const linksG = $('links');
  const nodesG = $('nodes');
  const boardsG = $('boards');
  const boardEditor = $('board-editor');
  const insertLine = $('insert-line');
  const editor = $('editor');
  const zoomLabel = $('zoom');
  const layoutButtons = [...root.querySelectorAll('#layout-group button')];
  const linkButton = $('btn-link');
  const sideButtons = [...root.querySelectorAll('#side-group button')];
  const meas = document.createElement('canvas').getContext('2d');
  const vw = () => svg.getBoundingClientRect().width;
  const vh = () => svg.getBoundingClientRect().height;

  // 親のないノードが中心ノード。中心ノードはいくつでも置けて、dx, dy がキャンバス上の位置になる。
  let nodes = new Map();
  let uid = 1;
  let selectedId = null;
  let editingId = null;
  let editOriginal = '';
  let view = { tx: 0, ty: 0, s: 1 };
  let undoStack = [], redoStack = [];
  let drag = null, pan = null;
  let animating = false;
  let hCache = new Map();
  const nodeEls = new Map(), linkEls = new Map();
  // ボードはキャンバス上の四角い区画 { id, name, x, y, w, h }（x, y は左上）。選択はノードとどちらか一方だけ。
  let boards = [];
  let selectedBoardId = null, editingBoardId = null, boardDrag = null;
  const boardEls = new Map();
  // ⇧ ドラッグの範囲選択。複数のノードとボードを選ぶ。単独の選択（selectedId・selectedBoardId）とは同時に持たない。
  const multi = { nodes: new Set(), boards: new Set() };
  let marquee = null; // ドラッグ中の枠 { x0, y0, x1, y1, startX, startY, moved }
  const marqueeEl = $('marquee');
  const nodeMenu = $('node-menu');

  // ---------- データ ----------
  function makeNode(text, parentId) {
    return { id: 'n' + (uid++), text, parentId, children: [], side: 'right', dx: 0, dy: 0,
      colorIndex: 0, collapsed: false, hidden: false, w: MIN_W, h: NODE_H, cx: 0, cy: 0, vx: null, vy: null, depth: 0 };
  }
  const isRoot = n => !n.parentId;
  function roots() { return [...nodes.values()].filter(isRoot); }
  function serialize() {
    return { uid, nodes: [...nodes.values()].map(n => ({
      id: n.id, text: n.text, parentId: n.parentId, children: n.children.slice(), side: n.side,
      layout: isRoot(n) ? layoutOf(n) : undefined,
      dx: n.dx, dy: n.dy, colorIndex: n.colorIndex, collapsed: n.collapsed, url: n.url || undefined })),
      boards: boards.map(b => ({ id: b.id, name: b.name, x: b.x, y: b.y, w: b.w, h: b.h })) };
  }
  // 古い形式を、いまの形式に直す。中心ノードが1つだった頃の rootId と rootPos を中心ノードの位置に移し、
  // 中心ノード以外を自由に置けた頃の固定（pinned と dx, dy）を外す。
  function normalize(data) {
    if (data && data.rootId) {
      const r = data.nodes.find(d => d.id === data.rootId);
      if (r && data.rootPos) { r.dx = data.rootPos.x; r.dy = data.rootPos.y; }
      delete data.rootId; delete data.rootPos;
    }
    if (data) for (const d of data.nodes) {
      if (d.parentId) { d.dx = 0; d.dy = 0; }
      delete d.pinned;
      if (d.url !== undefined) { const u = cleanUrl(d.url); if (u) d.url = u; else delete d.url; }
    }
    return data;
  }
  function restore(data) {
    normalize(data);
    const old = nodes;
    nodes = new Map();
    for (const d of data.nodes) {
      const n = makeNode(d.text, d.parentId);
      Object.assign(n, { id: d.id, children: d.children.slice(), side: d.side, dx: d.dx, dy: d.dy, colorIndex: d.colorIndex, collapsed: !!d.collapsed, layout: d.layout, url: d.url || undefined });
      nodes.set(n.id, n);
    }
    uid = data.uid;
    boards = (data.boards || []).map(b => ({ id: b.id, name: b.name, x: b.x, y: b.y, w: b.w, h: b.h }));
    for (const n of nodes.values()) { const o = old.get(n.id); if (o) { n.vx = o.vx; n.vy = o.vy; } }
    if (!nodes.has(selectedId)) selectedId = null;
    if (!boards.some(b => b.id === selectedBoardId)) selectedBoardId = null;
    for (const id of multi.nodes) if (!nodes.has(id)) multi.nodes.delete(id);
    for (const id of multi.boards) if (!boardById(id)) multi.boards.delete(id);
  }

  // ---------- 保存（store） ----------
  // 読み込んだときの版番号 version を添えて丸ごと書く。別の場所で先に書かれていたら、その最新を取り込む（自分の変更は ⌘Z で戻せる）。
  let store = null, unsubscribe = null;
  let lastSaved = '', saveTimer = null, inflight = null, version = 0;
  function save() {
    if (readOnly || !store) return;
    host.dispatchEvent(new CustomEvent('mindmap-change', { detail: { map: serialize() } }));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 150);
  }
  // 書き込みは1本ずつ送る。中身は送る時点の状態にする。
  async function flush() {
    saveTimer = null;
    if (inflight !== null) { saveTimer = setTimeout(flush, 150); return; }
    const map = serialize(), text = JSON.stringify(map);
    if (text === lastSaved || !store) return;
    const s = store;
    inflight = text;
    try {
      const res = await s.save(map, version);
      if (s !== store) return; // 送っている間に store が替わった
      if (res && res.ok) { if (res.version > version) { version = res.version; lastSaved = text; } }
      else if (res && res.conflict && res.map && res.version > version) applyExternal(res.map, res.version);
    } catch (e) { /* 届かなければ次の変更でもう一度送る */ } finally { inflight = null; }
  }
  function onRemote(msg) {
    if (!msg || !msg.map || !Array.isArray(msg.map.nodes) || msg.version <= version) return;
    const text = JSON.stringify(normalize(msg.map));
    // 自分が送った書き込みの知らせ。save の返事より先に届くことがある
    if (text === inflight || text === lastSaved) { version = msg.version; lastSaved = text; return; }
    applyExternal(msg.map, msg.version);
  }
  async function setStore(s) {
    if (unsubscribe) { try { unsubscribe(); } catch (e) { /* 無視 */ } unsubscribe = null; }
    // 待っている書き込みは前の store へ送ってから替える（flush は await の前に中身と store を取る）
    if (saveTimer && store && inflight === null) { clearTimeout(saveTimer); flush(); }
    clearTimeout(saveTimer); saveTimer = null;
    store = s;
    if (!s) return;
    let got = null;
    try { got = await s.load(); } catch (e) { got = null; }
    if (store !== s) return;
    if (editingId) { editor.style.display = 'none'; editingId = null; }
    closeNodeMenu(); closeLinkEditor();
    undoStack = []; redoStack = []; nodes = new Map(); clearMulti();
    if (got && got.map && Array.isArray(got.map.nodes) && got.map.nodes.length) {
      restore(got.map); version = got.version || 0; lastSaved = JSON.stringify(serialize());
      selectedId = roots()[0] ? roots()[0].id : null;
      view = { tx: vw() / 2, ty: vh() / 2, s: 1 };
      layout(); syncDom(); fitView();
    } else {
      version = got ? got.version || 0 : 0; lastSaved = '';
      newMap(); fitView();
    }
    if (s.subscribe) unsubscribe = s.subscribe(onRemote);
  }
  function setReadOnly(v) {
    readOnly = !!v;
    if (readOnly) { finishEdit(); closeLinkEditor(); }
    requestDraw();
  }
  function applyExternal(data, newVersion) {
    closeNodeMenu();
    if (editingId) { editor.style.display = 'none'; editingId = null; }
    clearTimeout(saveTimer); saveTimer = null;
    pushUndo();
    restore(data);
    lastSaved = JSON.stringify(serialize()); version = newVersion;
    layout(); syncDom(); requestDraw();
  }
  function pushUndo() { undoStack.push(JSON.stringify(serialize())); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; }
  function undo() { if (!undoStack.length) return; finishEdit(); redoStack.push(JSON.stringify(serialize())); restore(JSON.parse(undoStack.pop())); commit(); }
  function redo() { if (!redoStack.length) return; finishEdit(); undoStack.push(JSON.stringify(serialize())); restore(JSON.parse(redoStack.pop())); commit(); }

  function newMap() {
    nodes = new Map(); uid = 1; undoStack = []; redoStack = [];
    boards = []; selectedBoardId = null; clearMulti();
    const root = makeNode(rootTitle(), null);
    nodes.set(root.id, root);
    selectedId = root.id;
    view = { tx: vw() / 2, ty: vh() / 2, s: 1 };
    commit();
  }

  function subtreeIds(n, acc = new Set()) { acc.add(n.id); for (const id of n.children) subtreeIds(nodes.get(id), acc); return acc; }
  function nextColor(root) { return root.children.length % PALETTE.length; }
  // マップの配置。中心ノードの layout が both（両側）、right（右だけ）、left（左だけ）。
  // 右だけ・左だけのときは、中心ノードの子の side をすべてその向きに揃えておく。
  function layoutOf(root) { return root.layout || 'both'; }
  function rootOf(n) { while (n.parentId) n = nodes.get(n.parentId); return n; }
  // 中心ノードに子を足すときの向き。両側なら少ない側、片側ならその側。
  function newSide(root) {
    if (layoutOf(root) !== 'both') return layoutOf(root);
    const kids = root.children.map(id => nodes.get(id));
    const right = kids.filter(k => k.side === 'right').length;
    return right <= kids.length - right ? 'right' : 'left';
  }
  function setLayout(rootId, mode) {
    const r = nodes.get(rootId);
    if (!r || layoutOf(r) === mode) return;
    pushUndo();
    r.layout = mode;
    const kids = r.children.map(id => nodes.get(id));
    if (mode !== 'both') for (const k of kids) k.side = mode;
    else if (kids.every(k => k.side === kids[0].side)) kids.forEach((k, i) => { k.side = i % 2 ? 'left' : 'right'; });
    commit();
  }
  // 中心ノードの子のうち、n を含む枝。中心ノード自身なら null。
  function branchOf(n) {
    if (isRoot(n)) return null;
    while (!isRoot(nodes.get(n.parentId))) n = nodes.get(n.parentId);
    return n;
  }
  // 枝ごとに左右を決める。片側だけのマップで反対側へ出すと、そのマップは両側になる。
  function setSide(id, side) {
    const n = nodes.get(id), b = n && branchOf(n);
    if (!b || b.side === side) return;
    pushUndo();
    const r = rootOf(b);
    if (layoutOf(r) !== 'both') r.layout = 'both';
    b.side = side;
    commit();
  }
  function colorOf(n) {
    if (isRoot(n)) return null;
    let cur = n;
    while (!isRoot(nodes.get(cur.parentId))) cur = nodes.get(cur.parentId);
    return PALETTE[cur.colorIndex % PALETTE.length];
  }

  // ---------- 変更操作 ----------
  function commit() { fillLinkTitles(); save(); layout(); syncDom(); requestDraw(); }

  function addChild(parentId, text = '') {
    const p = nodes.get(parentId); if (!p || readOnly) return;
    pushUndo();
    p.collapsed = false;
    const n = makeNode(text, parentId);
    if (isRoot(p)) { n.side = newSide(p); n.colorIndex = nextColor(p); }
    nodes.set(n.id, n); p.children.push(n.id);
    selectedId = n.id; commit(); startEdit(n.id, null, true);
  }
  function addSibling(id) {
    const n = nodes.get(id); if (!n) return;
    if (isRoot(n)) return addChild(id);
    pushUndo();
    const p = nodes.get(n.parentId);
    const s = makeNode('', p.id);
    s.side = n.side;
    if (isRoot(p)) s.colorIndex = nextColor(p);
    nodes.set(s.id, s);
    p.children.splice(p.children.indexOf(id) + 1, 0, s.id);
    selectedId = s.id; commit(); startEdit(s.id, null, true);
  }
  // 背景のダブルクリックで、その位置に新しいマップを置く。
  function addRoot(x, y) {
    pushUndo();
    const n = makeNode('', null);
    n.dx = x; n.dy = y;
    nodes.set(n.id, n);
    selectedId = n.id; commit(); startEdit(n.id, null, true);
  }
  function deleteNode(id, recordUndo = true) {
    const n = nodes.get(id); if (!n) return;
    if (isRoot(n)) {
      // 中心ノードはマップごと消す。最後の1つは残す。
      if (roots().length === 1) return;
      if (recordUndo) pushUndo();
      for (const sid of subtreeIds(n)) nodes.delete(sid);
      selectedId = null;
      commit(); return;
    }
    if (recordUndo) pushUndo();
    const p = nodes.get(n.parentId);
    const idx = p.children.indexOf(id);
    for (const sid of subtreeIds(n)) nodes.delete(sid);
    p.children.splice(idx, 1);
    selectedId = p.children[idx] || p.children[idx - 1] || p.id;
    commit();
  }
  // ノードを別の親の下、または兄弟の間へ移す。drop は { parentId, side, beforeId, afterId }。
  // beforeId か afterId があればその隣に、なければ末尾に入れる。side は中心ノードの子のときだけ使う。
  function moveTo(id, drop, recordUndo = true) {
    const n = nodes.get(id), np = nodes.get(drop.parentId);
    if (!n || !np || subtreeIds(n).has(np.id)) return;
    if (recordUndo) pushUndo();
    const before = undoStack[undoStack.length - 1];
    const op = nodes.get(n.parentId);
    if (op) op.children.splice(op.children.indexOf(id), 1);
    if (isRoot(np)) {
      if (n.parentId !== np.id) n.colorIndex = nextColor(np);
      // 片側だけのマップで反対側へ置いたら、そのマップは両側になる
      if (layoutOf(np) !== 'both' && drop.side !== layoutOf(np)) np.layout = 'both';
      n.side = drop.side;
    }
    n.parentId = np.id; n.dx = 0; n.dy = 0; delete n.layout;
    const i = drop.beforeId ? np.children.indexOf(drop.beforeId)
      : drop.afterId ? np.children.indexOf(drop.afterId) + 1 : np.children.length;
    np.children.splice(i, 0, id);
    np.collapsed = false;
    if (recordUndo && JSON.stringify(serialize()) === before) { undoStack.pop(); requestDraw(); return; }
    commit();
  }

  // ---------- 範囲選択 ----------
  function clearMulti() { multi.nodes.clear(); multi.boards.clear(); }
  const hasMulti = () => multi.nodes.size + multi.boards.size > 0;
  function multiActive() { return !selectedId && !selectedBoardId && hasMulti(); }
  // 選んだノードのうち、祖先が選ばれていないもの。動かすのと消すのは、これを子孫ごと扱う。上から順に並べる。
  function multiTops() {
    const tops = [];
    for (const id of multi.nodes) {
      const n = nodes.get(id); if (!n) continue;
      let p = n.parentId, covered = false;
      while (p) { if (multi.nodes.has(p)) { covered = true; break; } p = nodes.get(p).parentId; }
      if (!covered) tops.push(n);
    }
    return tops.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  }
  // 枠に重なる見えているノードと、枠にすっぽり入るボードを選ぶ。1つだけならふつうの選択にする。
  function selectInRect(x1, y1, x2, y2) {
    const ns = [...nodes.values()].filter(n => !n.hidden
      && n.cx + n.w / 2 >= x1 && n.cx - n.w / 2 <= x2 && n.cy + n.h / 2 >= y1 && n.cy - n.h / 2 <= y2).map(n => n.id);
    const bs = boards.filter(b => b.x >= x1 && b.y >= y1 && b.x + b.w <= x2 && b.y + b.h <= y2).map(b => b.id);
    selectedId = null; selectedBoardId = null; clearMulti();
    if (ns.length + bs.length === 1) { if (ns.length) selectedId = ns[0]; else selectedBoardId = bs[0]; return; }
    for (const id of ns) multi.nodes.add(id);
    for (const id of bs) multi.boards.add(id);
  }
  // 範囲選択したものをまとめて消す。ノードは子孫ごと、中心ノードはマップごと（最後の1つは残す）、ボードはボードだけ。
  function deleteMulti(withBoards = true) {
    if (readOnly || !multiActive()) return;
    const tops = multiTops();
    pushUndo();
    for (const n of tops.filter(n => !isRoot(n))) {
      const p = nodes.get(n.parentId);
      p.children.splice(p.children.indexOf(n.id), 1);
      for (const sid of subtreeIds(n)) nodes.delete(sid);
    }
    for (const r of tops.filter(isRoot)) if (roots().length > 1) for (const sid of subtreeIds(r)) nodes.delete(sid);
    if (withBoards) boards = boards.filter(b => !multi.boards.has(b.id));
    clearMulti();
    commit();
  }
  // 複数の枝を、並びを保ったまま同じ場所へ移す。2つめからは前に移したものの後ろに入れる。
  function moveMany(ids, drop) {
    pushUndo();
    const before = undoStack[undoStack.length - 1];
    let d = drop;
    for (const id of ids) {
      moveTo(id, d, false);
      d = { parentId: drop.parentId, side: drop.side, beforeId: null, afterId: id };
    }
    if (JSON.stringify(serialize()) === before) undoStack.pop();
  }

  function toggleCollapse(id) {
    const n = nodes.get(id);
    if (!n || !n.children.length) return;
    pushUndo();
    n.collapsed = !n.collapsed;
    if (n.collapsed && selectedId && subtreeIds(n).has(selectedId)) selectedId = id;
    commit();
  }
  // 右クリックしたノードと、その下のノードだけを閉じる。兄弟や別の中心ノードには触れない。
  function canCollapseUnder(id) {
    const n = nodes.get(id);
    if (!n) return false;
    for (const sid of subtreeIds(n)) {
      const k = nodes.get(sid);
      if (k.children.length && !k.collapsed) return true;
    }
    return false;
  }
  function collapseUnder(id) {
    const n = nodes.get(id);
    if (!n || readOnly || !canCollapseUnder(id)) return;
    pushUndo();
    for (const sid of subtreeIds(n)) {
      const k = nodes.get(sid);
      if (k.children.length) k.collapsed = true;
    }
    if (selectedId && selectedId !== n.id && subtreeIds(n).has(selectedId)) selectedId = n.id;
    commit();
  }
  function closeNodeMenu() {
    if (!nodeMenu.classList.contains('show')) return false;
    nodeMenu.classList.remove('show');
    return true;
  }
  // 右クリックのボタンを離した瞬間に、開いたばかりの項目を押したことにしない
  let nodeMenuOpenedAt = 0, nodeMenuId = null;
  function openNodeMenu(id, x, y) {
    nodeMenuOpenedAt = performance.now();
    nodeMenuId = id;
    const item = nodeMenu.querySelector('[data-act=collapse-under]');
    item.disabled = !canCollapseUnder(id);
    nodeMenu.classList.add('show');
    // x, y は画面の座標。メニューは要素の中に置くので、要素の左上からの位置に直す
    const hr = host.getBoundingClientRect();
    x -= hr.left; y -= hr.top;
    const pad = parseFloat(getComputedStyle(host).getPropertyValue('--space-8'));
    const r = nodeMenu.getBoundingClientRect();
    nodeMenu.style.left = Math.max(pad, Math.min(x, hr.width - r.width - pad)) + 'px';
    nodeMenu.style.top = Math.max(pad, Math.min(y, hr.height - r.height - pad)) + 'px';
    if (!item.disabled) item.focus({ preventScroll: true });
  }
  nodeMenu.addEventListener('contextmenu', e => e.preventDefault());
  nodeMenu.addEventListener('click', e => {
    if (performance.now() - nodeMenuOpenedAt < 300) return;
    const act = e.target.closest('[data-act]');
    if (!act || act.disabled) return;
    closeNodeMenu();
    if (act.dataset.act === 'collapse-under') collapseUnder(nodeMenuId);
  });
  function descendantCount(n) { let c = 0; for (const id of n.children) c += 1 + descendantCount(nodes.get(id)); return c; }

  // ---------- 切り取り・コピー・貼り付け ----------
  // ノードは子孫ごと写す。クリップボードには箇条書き（CLI の import と同じ形）を書き、ほかのアプリやタブへも貼れる。
  // 同じページの中では、折りたたみや枝の左右も持った木（clip）を使うので、マップを切り替えてもそのまま移せる。
  let clip = null; // { text, trees: [{ text, url, root, layout, side, colorIndex, collapsed, children }] }
  function snapshot(n) {
    return { text: n.text, url: n.url, root: isRoot(n), layout: isRoot(n) ? layoutOf(n) : undefined, side: n.side, colorIndex: n.colorIndex,
      collapsed: n.collapsed, children: n.children.map(id => snapshot(nodes.get(id))) };
  }
  function toOutline(trees) {
    const lines = [];
    const walk = (it, d) => { lines.push('  '.repeat(d) + '- ' + linkText(it)); for (const c of it.children) walk(c, d + 1); };
    for (const t of trees) {
      if (t.root) { lines.push('# ' + linkText(t)); for (const c of t.children) walk(c, 0); } else walk(t, 0);
    }
    return lines.join('\n') + '\n';
  }
  // 貼られた文字を木の並びに読む。インデントが階層、「# 見出し」は中心ノード。箇条書きの記号がない行もそのまま項目にする。
  // 「[文字](URL)」と URL だけの行はリンクのノードになる（URL だけなら、題名を読み込んで文字にする）。
  function parseOutline(text) {
    const trees = [];
    let stack = [{ indent: -1, children: trees }];
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const h = raw.match(/^#+\s+(.+?)\s*$/);
      if (h) {
        const it = { ...splitLink(h[1]), root: true, children: [] };
        trees.push(it); stack = [{ indent: -1, children: it.children }];
        continue;
      }
      const m = raw.match(/^(\s*)(?:(?:[-*+]|\d+[.)])\s+)?(.*?)\s*$/);
      const indent = m[1].replace(/\t/g, '    ').length;
      const it = { ...splitLink(m[2]), children: [] };
      while (stack[stack.length - 1].indent >= indent) stack.pop();
      stack[stack.length - 1].children.push(it);
      stack.push({ indent, children: it.children });
    }
    return trees;
  }
  // 選択中のノードを写す。切り取りなら消す（最後の中心ノードと、閲覧のみの領域では消さずに写すだけ）。写した文字を返す。
  // 範囲選択のときは、選んだ枝とマップを上から順に写す（ボードは写さず、切り取りでも残す）。
  function copySelected(cut) {
    if (multiActive()) {
      const tops = multiTops(); if (!tops.length) return null;
      const trees = tops.map(snapshot);
      clip = { text: toOutline(trees), trees };
      if (cut && !readOnly) deleteMulti(false);
      return clip.text;
    }
    const n = nodes.get(selectedId); if (!n) return null;
    const trees = [snapshot(n)];
    clip = { text: toOutline(trees), trees };
    if (cut && !readOnly) deleteNode(n.id);
    return clip.text;
  }
  // 選択中のノードの子として足す。中心ノード（「# 見出し」を含む）と、選択がないときは、新しいマップとして置く。
  function pasteTrees(trees) {
    if (!trees.length || readOnly) return;
    pushUndo();
    const build = (it, parentId) => {
      const n = makeNode(it.text, parentId);
      if (it.url) n.url = it.url;
      n.collapsed = !!it.collapsed && it.children.length > 0;
      nodes.set(n.id, n);
      for (const c of it.children) n.children.push(build(c, n.id).id);
      return n;
    };
    const parent = nodes.get(selectedId);
    const branches = parent ? trees.filter(it => !it.root) : [];
    const maps = parent ? trees.filter(it => it.root) : trees;
    let first = null;
    if (branches.length) {
      parent.collapsed = false;
      for (const it of branches) {
        const n = build(it, parent.id);
        if (isRoot(parent)) { n.side = newSide(parent); n.colorIndex = nextColor(parent); }
        parent.children.push(n.id);
        first = first || n;
      }
    }
    if (maps.length) {
      // 重ならないよう、いまあるノードの下に縦に並べ、最初のマップへ画面を寄せる
      layout();
      let bottom = -Infinity;
      for (const n of nodes.values()) if (!n.hidden) bottom = Math.max(bottom, n.cy + n.h / 2);
      const added = maps.map(it => {
        const r = build(it, null);
        r.layout = it.layout || 'both';
        r.children.forEach((id, j) => {
          const k = nodes.get(id), src = it.children[j];
          k.side = r.layout !== 'both' ? r.layout : it.root && src.side ? src.side : j % 2 ? 'left' : 'right';
          k.colorIndex = it.root && src.colorIndex != null ? src.colorIndex : j % PALETTE.length;
        });
        return r;
      });
      layout();
      const x = toWorld(vw() / 2, vh() / 2).x;
      for (const r of added) { const h = subH(r); r.dx = x; r.dy = bottom + 80 + h / 2; bottom = r.dy + h / 2; }
      first = added[0];
      view.ty = vh() / 2 - first.dy * view.s;
    }
    selectedId = first.id;
    commit();
  }
  // 文字の編集中や入力欄、ページの文字を選んでいるときは、ふつうの文字のコピー・貼り付けにする。
  function textClipboard(e) {
    const t = tgt(e);
    if (editingId || (t.closest && t.closest('input, textarea, .popover'))) return true;
    const s = window.getSelection();
    return !!(s && !s.isCollapsed && !editor.contains(s.anchorNode));
  }
  // ⌘C・⌘X・⌘V は copy・cut・paste のイベントで受ける。イベントが来ないブラウザ向けに、キーを押した直後に代わりを走らせる。
  let pendingClip = null;
  function onClipKey(key) {
    pendingClip = key;
    setTimeout(() => {
      if (pendingClip !== key) return;
      pendingClip = null;
      if (key === 'v') { if (clip) pasteTrees(clip.trees); return; }
      const text = copySelected(key === 'x');
      if (text !== null && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    }, 0);
  }
  for (const type of ['copy', 'cut']) host.addEventListener(type, e => {
    pendingClip = null;
    if (textClipboard(e)) return;
    const text = copySelected(type === 'cut');
    if (text === null) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
  });
  host.addEventListener('paste', e => {
    pendingClip = null;
    if (readOnly || textClipboard(e)) return;
    const text = e.clipboardData.getData('text/plain').replace(/\r\n/g, '\n');
    const trees = clip && text.trim() === clip.text.trim() ? clip.trees : parseOutline(text);
    if (!trees.length) return;
    e.preventDefault();
    pasteTrees(trees);
  });

  // ---------- リンク ----------
  // ノードは URL を1つ持てる（n.url）。リンクのノードは、サーバーの /api/unfurl で読んだアイコンと題名を
  // 1行に並べる（Figma: Links）。文字が空のリンクには、読み込んだ題名を文字として入れる。
  function cleanUrl(value) {
    const s = String(value == null ? '' : value).trim();
    if (!/^https?:\/\/\S+$/i.test(s) || s.length > 2048) return null;
    try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch (e) { return null; }
  }
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } }
  // 箇条書きの1項目を文字とリンクに分ける。「[文字](URL)」と URL だけがリンク（lib/map.ts の splitLink と同じ）
  function splitLink(raw) {
    const m = raw.match(/^\[(.*)\]\((\S+)\)$/);
    const url = m ? cleanUrl(m[2]) : null;
    if (m && url) return { text: m[1].trim(), url };
    const bare = cleanUrl(raw);
    return bare ? { text: '', url: bare } : { text: raw };
  }
  function linkText(n) { return !n.url ? n.text : n.text ? `[${n.text}](${n.url})` : n.url; }
  // 幅 max に収まるよう末尾を「…」にする
  const truncCache = new Map();
  function truncate(text, font, max) {
    const key = font + '\n' + max + '\n' + text;
    if (truncCache.has(key)) return truncCache.get(key);
    meas.font = font;
    let out = text;
    if (meas.measureText(text).width > max) {
      const chars = Array.from(text);
      let lo = 0, hi = chars.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (meas.measureText(chars.slice(0, mid).join('') + '…').width <= max) lo = mid; else hi = mid - 1; }
      out = chars.slice(0, lo).join('').trimEnd() + '…';
    }
    if (truncCache.size > 2000) truncCache.clear();
    truncCache.set(key, out);
    return out;
  }

  // リンク先の題名など。URL ごとに1度だけ取りに行き、同時には4本まで。読めなければドメインで代える。
  const linkMetas = new Map(); // url → { status: 'loading' | 'ok' | 'error', title, site, description, image, icon }
  const metaQueue = [];
  let metaActive = 0;
  function metaOf(url) {
    let m = linkMetas.get(url);
    if (!m) { m = { status: 'loading', title: '', site: hostOf(url), description: '', image: '', icon: '' }; linkMetas.set(url, m); metaQueue.push(url); pumpMeta(); }
    return m;
  }
  function pumpMeta() {
    while (metaActive < 4 && metaQueue.length) {
      const url = metaQueue.shift();
      metaActive++;
      Promise.resolve(store && store.unfurl ? store.unfurl(url) : null).catch(() => null).then(data => {
        metaActive--;
        linkMetas.set(url, data && data.title ? { status: data.ok ? 'ok' : 'error', ...data }
          : { status: 'error', title: hostOf(url), site: hostOf(url), description: '', image: '', icon: '' });
        if (fillLinkTitles()) save();
        layout(); requestDraw();
        pumpMeta();
      });
    }
  }
  // 文字の空いたリンクに、読み込めた題名を入れる。閲覧のみの領域と、編集中のノードには入れない。入れたら true
  function fillLinkTitles() {
    if (readOnly) return false;
    let changed = false;
    for (const n of nodes.values()) {
      if (!n.url || n.text || n.id === editingId) continue;
      const m = metaOf(n.url);
      if (m.status !== 'loading') { n.text = m.title || hostOf(n.url); changed = true; }
    }
    return changed;
  }
  function drawLink(n, e) {
    const b = linkBox(n), x0 = b.padL + b.icon + b.gap, m = metaOf(n.url);
    const fy = (n.h - b.icon) / 2;
    for (const icon of [e.globe, e.fav]) {
      icon.setAttribute('x', b.padL); icon.setAttribute('y', fy); icon.setAttribute('width', b.icon); icon.setAttribute('height', b.icon);
    }
    if (e.favHref !== (m.icon || '')) {
      e.favHref = m.icon || '';
      e.fav.style.display = 'none'; e.globe.style.display = '';
      if (e.favHref) e.fav.setAttribute('href', e.favHref); else e.fav.removeAttribute('href');
    }
    e.lTitle.setAttribute('x', x0); e.lTitle.setAttribute('y', n.h / 2);
    if (e.lTitle.textContent !== n.linkTitle) e.lTitle.textContent = n.linkTitle;
    e.openIcon.setAttribute('width', b.open); e.openIcon.setAttribute('height', b.open);
    e.openHit.setAttribute('width', b.open + 8); e.openHit.setAttribute('height', b.open + 8);
    e.open.setAttribute('transform', `translate(${x0 + n.linkTitleW + b.gap},${(n.h - b.open) / 2})`);
  }
  function openLink(id) {
    const n = nodes.get(id);
    if (n && n.url) window.open(n.url, '_blank', 'noopener,noreferrer');
  }

  // リンクのパネル（Figma: Panel/Link）。リンクのノードを1つ選ぶと、枝の伸びる側に、上端をそろえて出す。
  // 画面からはみ出すなら反対側、それでも入らなければ下に出す。ドラッグ中と文字の編集中は隠す。
  const linkPanel = $('link-panel');
  const linkEdit = $('link-edit');
  const leUrl = $('le-url'), leError = $('le-error');
  let linkPanelKey = '', linkEditFor = null;
  function nodeRect(n) {
    const r = svg.getBoundingClientRect();
    const left = r.left + view.tx + view.s * (n.vx - n.w / 2), top = r.top + view.ty + view.s * (n.vy - n.h / 2);
    return { left, top, right: left + view.s * n.w, bottom: top + view.s * n.h };
  }
  function placeAt(el, x, y) {
    const M = 8, w = el.offsetWidth, h = el.offsetHeight;
    // x, y は画面の座標。パネルは要素の中に置くので、要素の左上からの位置に直して、要素の内側に収める
    const hr = host.getBoundingClientRect();
    x -= hr.left; y -= hr.top;
    x = Math.max(M, Math.min(x, hr.width - w - M)); y = Math.max(M, Math.min(y, hr.height - h - M));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  function renderLinkPanel(n) {
    const m = metaOf(n.url);
    const icon = $('lp-icon'), image = $('lp-image');
    icon.hidden = !m.icon; if (m.icon) icon.src = m.icon; else icon.removeAttribute('src');
    icon.onerror = () => { icon.hidden = true; };
    $('lp-site').textContent = m.site || hostOf(n.url);
    $('lp-title').textContent = m.status === 'loading' ? (n.text || '読み込み中…') : (m.title || n.text || hostOf(n.url));
    $('lp-desc').textContent = m.description || '';
    image.hidden = !m.image; if (m.image) image.src = m.image; else image.removeAttribute('src');
    image.onerror = () => { image.hidden = true; };
    const a = $('lp-url'); a.href = n.url; a.textContent = n.url; a.title = n.url;
  }
  function updateLinkPanels() {
    const n = nodes.get(selectedId);
    const show = !!n && !!n.url && !n.hidden && !editingId && !linkEditFor && !(drag && drag.moved) && !boardDrag;
    if (!show) { if (linkPanel.classList.contains('show')) linkPanel.classList.remove('show'); linkPanelKey = ''; }
    else {
      const m = metaOf(n.url), key = [n.id, n.url, n.text, m.status].join('\n');
      if (key !== linkPanelKey) { linkPanelKey = key; renderLinkPanel(n); }
      linkPanel.classList.add('show');
      const r = nodeRect(n), w = linkPanel.offsetWidth, p = n.parentId && nodes.get(n.parentId);
      const outward = p && n.cx < p.cx ? -1 : 1;
      const hr = host.getBoundingClientRect();
      const fits = x => x >= hr.left + 8 && x + w <= hr.right - 8;
      const side = outward > 0 ? r.right + 12 : r.left - 12 - w, other = outward > 0 ? r.left - 12 - w : r.right + 12;
      if (fits(side)) placeAt(linkPanel, side, r.top - 4);
      else if (fits(other)) placeAt(linkPanel, other, r.top - 4);
      else placeAt(linkPanel, r.left, r.bottom + 8);
    }
    const en = linkEditFor && nodes.get(linkEditFor);
    if (linkEditFor && !en) closeLinkEditor();
    else if (en) { const r = nodeRect(en); placeAt(linkEdit, r.left, r.bottom + 8); }
  }
  // ⌘K: 選択中のノードにリンクを付ける・直す（Figma: Panel/Link edit）
  function openLinkEditor() {
    const n = nodes.get(selectedId);
    if (readOnly || !n) return;
    finishEdit();
    linkEditFor = n.id;
    leUrl.value = n.url || ''; leError.textContent = '';
    $('le-unlink').hidden = !n.url;
    linkEdit.classList.add('show');
    updateLinkPanels();
    leUrl.focus(); leUrl.select();
    requestDraw();
  }
  function closeLinkEditor() {
    if (!linkEditFor) return false;
    linkEditFor = null;
    linkEdit.classList.remove('show');
    if (root.activeElement === leUrl) leUrl.blur();
    requestDraw();
    return true;
  }
  function setLink(id, url) {
    const n = nodes.get(id);
    if (!n || readOnly || n.url === url) return;
    pushUndo();
    if (url) n.url = url; else delete n.url;
    commit();
  }
  linkEdit.addEventListener('submit', e => {
    e.preventDefault();
    const url = cleanUrl(leUrl.value);
    if (!url) { leError.textContent = 'http:// か https:// で始まる URL を入れてください'; leUrl.focus(); return; }
    const id = linkEditFor;
    closeLinkEditor();
    setLink(id, url);
  });
  $('le-close').addEventListener('click', closeLinkEditor);
  $('le-unlink').addEventListener('click', () => { const id = linkEditFor; closeLinkEditor(); setLink(id, null); });
  $('lp-open').addEventListener('click', () => openLink(selectedId));
  $('lp-edit').addEventListener('click', openLinkEditor);
  $('lp-unlink').addEventListener('click', () => setLink(selectedId, null));

  // ---------- ボード ----------
  // ボードはマップをまとめて動かすための区画。どのマップが中にあるかは持たず、
  // 名前をつかんで動かし始めたときに、中心ノードがボードの内側にあるマップと、内側にすっぽり入るボードを中身とみなす。
  const BOARD_PAD = 48, BOARD_TITLE = 40, BOARD_MIN_W = 160, BOARD_MIN_H = 100;
  const BOARD_LABEL_FONT = '600 13px ' + FONT_FAMILY;
  function boardById(id) { return boards.find(b => b.id === id); }
  function boardContains(b, x, y) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }
  function boardInside(outer, b) { return b !== outer && b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h; }
  function selectBoard(id) { selectedBoardId = id; if (id) selectedId = null; }
  // 選択中のノードのマップを囲む。範囲選択なら、選んだノードのマップとボードをまとめて囲む。選択がなければ画面の真ん中に置く。
  function addBoard() {
    if (readOnly) return;
    finishEdit();
    pushUndo();
    const sel = nodes.get(selectedId);
    const maps = new Set(), around = [];
    if (multiActive()) {
      for (const n of multiTops()) maps.add(rootOf(n));
      around.push(...boards.filter(b => multi.boards.has(b.id)));
    } else if (sel) maps.add(rootOf(sel));
    let x, y, w, h;
    if (maps.size || around.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of maps) for (const id of subtreeIds(r)) {
        const n = nodes.get(id); if (n.hidden) continue;
        minX = Math.min(minX, n.cx - n.w / 2); maxX = Math.max(maxX, n.cx + n.w / 2);
        minY = Math.min(minY, n.cy - n.h / 2); maxY = Math.max(maxY, n.cy + n.h / 2);
      }
      // 中のボードの上端は名前を含むので、名前の分の余白を二重に取らない
      for (const b of around) {
        minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + b.w);
        minY = Math.min(minY, b.y + BOARD_TITLE); maxY = Math.max(maxY, b.y + b.h);
      }
      x = minX - BOARD_PAD; y = minY - BOARD_PAD - BOARD_TITLE;
      w = maxX - minX + BOARD_PAD * 2; h = maxY - minY + BOARD_PAD * 2 + BOARD_TITLE;
    } else {
      const c = toWorld(vw() / 2, vh() / 2);
      w = 800; h = 500; x = c.x - w / 2; y = c.y - h / 2;
    }
    const b = { id: 'b' + (uid++), name: `ボード ${boards.length + 1}`, x, y, w, h };
    boards.push(b);
    selectBoard(b.id);
    commit();
    startBoardEdit(b.id);
  }
  // ボードだけを消す。中のマップは残す。
  function removeBoard(id) {
    if (!boardById(id)) return;
    pushUndo();
    boards = boards.filter(b => b.id !== id);
    selectedBoardId = null;
    commit();
  }
  function startBoardEdit(id) {
    const b = boardById(id); if (!b || readOnly) return;
    finishEdit(); finishBoardEdit();
    editingBoardId = id;
    boardEditor.value = b.name;
    boardEditor.style.display = 'block';
    draw();
    boardEditor.focus(); boardEditor.select();
  }
  function finishBoardEdit(cancel = false) {
    if (!editingBoardId) return;
    const b = boardById(editingBoardId);
    editingBoardId = null;
    boardEditor.style.display = 'none';
    const name = boardEditor.value.replace(/[\r\n]/g, '').trim();
    if (!cancel && b && name && name !== b.name) { pushUndo(); b.name = name; commit(); } else requestDraw();
  }
  boardEditor.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); finishBoardEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); finishBoardEdit(true); }
  });
  boardEditor.addEventListener('blur', () => finishBoardEdit());
  function syncBoards() {
    for (const [id, e] of boardEls) if (!boardById(id)) { e.g.remove(); boardEls.delete(id); }
    for (const b of boards) {
      if (boardEls.has(b.id)) continue;
      const g = el('g', { class: 'board' }); g.dataset.id = b.id;
      const rect = el('rect', { class: 'board-rect', rx: 12, ry: 12 });
      const title = el('g', { class: 'board-title' });
      const tRect = el('rect', { rx: 6, ry: 6, height: 24 });
      const tText = el('text', { x: 8, y: 12, 'dominant-baseline': 'central' });
      title.append(tRect, tText);
      const handles = ['nw', 'ne', 'sw', 'se'].map(c => { const h = el('rect', { class: 'board-handle', rx: 2, ry: 2 }); h.dataset.corner = c; return h; });
      g.append(rect, title, ...handles);
      boardEls.set(b.id, { g, rect, title, tRect, tText, handles });
    }
    // 大きいボードを奥に置き、入れ子のボードが上に見えるようにする
    for (const b of [...boards].sort((p, q) => q.w * q.h - p.w * p.h)) boardsG.appendChild(boardEls.get(b.id).g);
  }
  // 名前と角の印は、拡大率によらず画面上で同じ大きさにする
  function drawBoards() {
    const k = 1 / view.s, hs = 10 * k;
    meas.font = BOARD_LABEL_FONT;
    for (const b of boards) {
      const e = boardEls.get(b.id);
      e.g.setAttribute('class', 'board' + (b.id === selectedBoardId ? ' selected' : '') + (multi.boards.has(b.id) ? ' selected multi' : '')
        + (b.id === editingBoardId ? ' editing' : ''));
      e.rect.setAttribute('x', b.x); e.rect.setAttribute('y', b.y);
      e.rect.setAttribute('width', b.w); e.rect.setAttribute('height', b.h);
      if (e.tText.textContent !== b.name) e.tText.textContent = b.name;
      e.tRect.setAttribute('width', Math.ceil(meas.measureText(b.name).width) + 16);
      e.title.setAttribute('transform', `translate(${b.x + 10 * k},${b.y + 10 * k}) scale(${k})`);
      for (const h of e.handles) {
        const c = h.dataset.corner;
        h.setAttribute('x', (c.includes('w') ? b.x : b.x + b.w) - hs / 2);
        h.setAttribute('y', (c.includes('n') ? b.y : b.y + b.h) - hs / 2);
        h.setAttribute('width', hs); h.setAttribute('height', hs);
      }
    }
    const eb = editingBoardId && boardById(editingBoardId);
    if (eb) boardEditor.style.transform = `translate(${view.tx + view.s * eb.x + 10}px, ${view.ty + view.s * eb.y + 10}px)`;
  }

  // ---------- レイアウト ----------
  function measure(n) {
    const root = isRoot(n);
    if (n.url) {
      // リンクはアイコン・題名（編集中は打っている文字のまま）・↗ を並べた幅にする
      const b = linkBox(n), font = (root ? '600 18px ' : '15px ') + FONT_FAMILY;
      n.linkTitle = n.id === editingId ? n.text : truncate(n.text || metaOf(n.url).title || hostOf(n.url), font, LINK_TITLE_MAX);
      meas.font = font; n.linkTitleW = meas.measureText(n.linkTitle).width;
      n.w = Math.ceil(b.padL + b.icon + b.gap + n.linkTitleW + b.gap + b.open + b.padR);
      n.h = root ? ROOT_H : NODE_H;
      return;
    }
    meas.font = (root ? '600 18px ' : '15px ') + FONT_FAMILY;
    const tw = meas.measureText(n.text).width;
    const pad = root ? ROOT_PAD : PAD;
    n.w = Math.max(MIN_W, Math.ceil(tw) + pad * 2);
    n.h = root ? ROOT_H : NODE_H;
  }
  function subH(n) {
    if (hCache.has(n.id)) return hCache.get(n.id);
    const kids = n.collapsed ? [] : n.children.map(id => nodes.get(id));
    let h = n.h;
    if (kids.length) {
      let s = 0; for (const k of kids) s += subH(k);
      h = Math.max(n.h, s + VGAP * (kids.length - 1));
    }
    hCache.set(n.id, h); return h;
  }
  function placeStack(parent, kids, dir) {
    const total = kids.reduce((a, k) => a + subH(k), 0) + VGAP * Math.max(0, kids.length - 1);
    let y = parent.cy - total / 2;
    for (const k of kids) {
      const sh = subH(k);
      k.cy = y + sh / 2;
      k.cx = parent.cx + dir * (parent.w / 2 + HGAP + k.w / 2);
      k.depth = parent.depth + 1;
      y += sh + VGAP;
      placeChildren(k, dir);
    }
  }
  function hideSubtree(n) {
    for (const id of n.children) {
      const k = nodes.get(id);
      k.hidden = true; k.cx = n.cx; k.cy = n.cy; k.vx = n.cx; k.vy = n.cy; k.depth = n.depth + 1;
      hideSubtree(k);
    }
  }
  function placeChildren(n, dir) {
    if (n.collapsed) { hideSubtree(n); return; }
    placeStack(n, n.children.map(id => nodes.get(id)), dir);
  }
  function layout() {
    for (const n of nodes.values()) { measure(n); n.hidden = false; }
    hCache = new Map();
    for (const root of roots()) {
      root.cx = root.dx; root.cy = root.dy; root.depth = 0;
      if (root.collapsed) { hideSubtree(root); continue; }
      const kids = root.children.map(id => nodes.get(id));
      placeStack(root, kids.filter(k => k.side === 'right'), 1);
      placeStack(root, kids.filter(k => k.side === 'left'), -1);
    }
  }

  // ---------- 描画 ----------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs = {}) { const e = document.createElementNS(SVG_NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function syncDom() {
    syncBoards();
    for (const [id, e] of nodeEls) if (!nodes.has(id)) { e.g.remove(); nodeEls.delete(id); }
    for (const [id, p] of linkEls) if (!nodes.has(id) || !nodes.get(id).parentId) { p.remove(); linkEls.delete(id); }
    for (const n of nodes.values()) {
      if (!nodeEls.has(n.id)) {
        // ノードは本体の四角、選択のリング（本体の 2px 外側）、文字、折りたたみの印（Figma: Node・Toggle）
        const g = el('g', { class: 'node' }); g.dataset.id = n.id;
        const ring = el('rect', { class: 'sel-ring' });
        const rect = el('rect', { class: 'body' });
        const text = el('text', { class: 'label', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        // リンクのとき: サイトのアイコン（読めなければ地球）・題名・↗
        const link = el('g', { class: 'link-parts' });
        const globe = el('use', { class: 'fav-globe', href: '#i-globe' });
        const fav = el('image', { class: 'fav', preserveAspectRatio: 'xMidYMid meet' });
        fav.style.display = 'none';
        fav.addEventListener('load', () => { fav.style.display = ''; globe.style.display = 'none'; });
        fav.addEventListener('error', () => { fav.style.display = 'none'; globe.style.display = ''; });
        const lTitle = el('text', { class: 'link-title', 'dominant-baseline': 'central' });
        const open = el('g', { class: 'link-open' });
        const openTitle = el('title'); openTitle.textContent = '新しいタブで開く';
        const openHit = el('rect', { x: -4, y: -4, fill: 'transparent' }), openIcon = el('use', { href: '#i-external' });
        open.append(openTitle, openHit, openIcon);
        link.append(globe, fav, lTitle, open);
        const toggle = el('g', { class: 'toggle' });
        const tPill = el('rect', { height: TOGGLE_H, y: -TOGGLE_H / 2, rx: TOGGLE_H / 2, ry: TOGGLE_H / 2 });
        const tDash = el('line', { class: 'dash', x1: -3.5, y1: 0, x2: 3.5, y2: 0 });
        const tText = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        toggle.append(tPill, tDash, tText);
        g.append(ring, rect, text, link, toggle); nodesG.appendChild(g);
        nodeEls.set(n.id, { g, ring, rect, text, link, globe, fav, favHref: null, lTitle, open, openHit, openIcon, toggle, tPill, tDash, tText });
      }
      if (n.parentId && !linkEls.has(n.id)) {
        const p = el('path', { class: 'link' }); linksG.appendChild(p); linkEls.set(n.id, p);
      }
    }
  }
  function requestDraw() { if (!animating) { animating = true; requestAnimationFrame(frame); } }
  // 折りたたみの印を出す側。中心ノードは枝のある側（両側なら右）、ほかは親の反対側。
  function toggleDir(n) {
    if (!isRoot(n)) return nodes.get(n.parentId).cx <= n.cx ? 1 : -1;
    if (layoutOf(n) === 'left') return -1;
    if (layoutOf(n) === 'right') return 1;
    let right = 0, left = 0;
    for (const id of n.children) (nodes.get(id).side === 'left' ? left++ : right++);
    return left > right ? -1 : 1;
  }
  function initVisuals() {
    for (const n of nodes.values()) {
      if (n.vx != null) continue;
      const p = n.parentId ? nodes.get(n.parentId) : null;
      n.vx = p && p.vx != null ? p.vx : n.cx; n.vy = p && p.vy != null ? p.vy : n.cy;
    }
  }
  function frame() {
    let moving = false;
    initVisuals();
    for (const n of nodes.values()) {
      const off = dragOffset(n);
      const ddx = n.cx + off.x - n.vx, ddy = n.cy + off.y - n.vy;
      if (Math.abs(ddx) > 0.4 || Math.abs(ddy) > 0.4) { n.vx += ddx * 0.28; n.vy += ddy * 0.28; moving = true; }
      else { n.vx = n.cx + off.x; n.vy = n.cy + off.y; }
    }
    draw();
    if (moving) requestAnimationFrame(frame); else animating = false;
  }
  function draw() {
    initVisuals();
    // 単独の選択ができたら、範囲の選択は外す（ノードの追加や貼り付けで選択が移ったときも）
    if ((selectedId || selectedBoardId) && hasMulti()) clearMulti();
    world.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.s})`);
    zoomLabel.textContent = Math.round(view.s * 100) + '%';
    drawBoards();
    const sel = nodes.get(selectedId), mode = sel ? layoutOf(rootOf(sel)) : null;
    for (const b of layoutButtons) { b.disabled = !sel; b.classList.toggle('active', b.dataset.layout === mode); }
    linkButton.disabled = !sel;
    const branch = sel && branchOf(sel);
    for (const b of sideButtons) { b.disabled = !branch; b.classList.toggle('active', !!branch && b.dataset.side === branch.side); }
    for (const n of nodes.values()) {
      const e = nodeEls.get(n.id);
      const color = colorOf(n);
      e.g.setAttribute('transform', `translate(${n.vx - n.w / 2},${n.vy - n.h / 2})`);
      e.g.setAttribute('class', 'node' + (isRoot(n) ? ' root' : '') + (n.id === selectedId || multi.nodes.has(n.id) ? ' selected' : '')
        + (drag && drag.drop && drag.drop.parentId === n.id && !drag.drop.line ? ' drop-target' : '')
        + (n.id === editingId ? ' editing' : '') + (dragOffset(n).x || dragOffset(n).y ? ' dragging' : '')
        + (n.hidden ? ' hidden' : '') + (n.collapsed ? ' collapsed' : '') + (n.url ? ' is-link' : ''));
      const r = isRoot(n) ? ROOT_R : NODE_R, o = RING_GAP + 1; // リングの線（2px）の中心は、本体の外側 3px
      e.rect.setAttribute('width', n.w); e.rect.setAttribute('height', n.h);
      e.rect.setAttribute('rx', r); e.rect.setAttribute('ry', r);
      e.ring.setAttribute('x', -o); e.ring.setAttribute('y', -o);
      e.ring.setAttribute('width', n.w + o * 2); e.ring.setAttribute('height', n.h + o * 2);
      e.ring.setAttribute('rx', r + o); e.ring.setAttribute('ry', r + o);
      if (color) e.rect.style.stroke = color; else e.rect.style.stroke = '';
      if (n.url) drawLink(n, e);
      else {
        e.text.setAttribute('x', n.w / 2); e.text.setAttribute('y', n.h / 2);
        if (e.text.textContent !== n.text) e.text.textContent = n.text;
      }
      if (n.children.length) {
        // 中心ノードに枝の色はない。しまう印は白文字が読める枝の青を使う。
        const toggleColor = color || 'var(--color-branch-5)';
        const d = toggleDir(n);
        // 閉じているときは子孫の数を入れる。2桁からは横に伸びる丸にする
        const label = n.collapsed ? String(descendantCount(n)) : '';
        meas.font = '700 11px ' + FONT_FAMILY;
        const pw = label ? Math.max(TOGGLE_H, Math.ceil(meas.measureText(label).width) + 8) : TOGGLE_H;
        e.toggle.style.display = '';
        e.toggle.setAttribute('transform', `translate(${d === 1 ? n.w + TOGGLE_GAP + pw / 2 : -TOGGLE_GAP - pw / 2},${n.h / 2})`);
        e.tPill.setAttribute('x', -pw / 2); e.tPill.setAttribute('width', pw);
        e.tPill.style.stroke = toggleColor; e.tDash.style.stroke = toggleColor;
        e.g.style.setProperty('--toggle-fill', toggleColor);
        e.tDash.style.display = n.collapsed ? 'none' : '';
        if (e.tText.textContent !== label) e.tText.textContent = label;
      } else e.toggle.style.display = 'none';
      if (n.parentId) {
        const p = nodes.get(n.parentId), path = linkEls.get(n.id);
        path.classList.toggle('hidden', n.hidden);
        const d = p.vx <= n.vx ? 1 : -1;
        const x1 = p.vx + d * p.w / 2, y1 = p.vy, x2 = n.vx - d * n.w / 2, y2 = n.vy;
        const mx = (x1 + x2) / 2;
        path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
        path.style.stroke = color;
        path.setAttribute('stroke-width', Math.max(1.5, 5 - n.depth * 1.2));
      }
    }
    const line = drag && drag.drop && drag.drop.line;
    insertLine.style.display = line ? 'block' : 'none';
    if (line) for (const k of ['x1', 'x2', 'y1', 'y2']) insertLine.setAttribute(k, line[k]);
    marqueeEl.style.display = marquee && marquee.moved ? 'block' : 'none';
    if (marquee) {
      marqueeEl.setAttribute('x', Math.min(marquee.x0, marquee.x1)); marqueeEl.setAttribute('y', Math.min(marquee.y0, marquee.y1));
      marqueeEl.setAttribute('width', Math.abs(marquee.x1 - marquee.x0)); marqueeEl.setAttribute('height', Math.abs(marquee.y1 - marquee.y0));
    }
    if (editingId) {
      const n = nodes.get(editingId);
      const root = isRoot(n), fs = root ? 18 : 15, b = linkBox(n);
      // リンクはアイコンの右の題名に重ねる
      const pad = n.url ? b.padL + b.icon + b.gap : root ? ROOT_PAD : PAD;
      const wx = n.vx - n.w / 2 + pad, wy = n.vy - fs * 0.6;
      editor.style.fontSize = fs + 'px'; editor.style.fontWeight = root ? '600' : '400';
      editor.style.transform = `translate(${view.tx + view.s * wx}px, ${view.ty + view.s * wy}px) scale(${view.s})`;
    }
    updateLinkPanels();
  }

  // ---------- 編集 ----------
  function startEdit(id, replaceWith = null, fresh = false) {
    finishEdit();
    const n = nodes.get(id); if (!n) return;
    pushUndo();
    editingId = id; editOriginal = fresh ? '' : n.text;
    if (replaceWith !== null) n.text = replaceWith;
    editor.textContent = n.text;
    editor.style.display = 'block';
    layout(); draw();
    editor.focus();
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    requestDraw();
  }
  function finishEdit() {
    if (!editingId) return;
    const n = nodes.get(editingId);
    editor.style.display = 'none';
    editingId = null;
    if (!n) return;
    n.text = editor.textContent.replace(/[\r\n]/g, '').trim();
    // URL だけを書いたらリンクにする。題名はあとで読み込んで文字にする
    const url = cleanUrl(n.text);
    if (url) { n.url = url; n.text = ''; }
    if (n.text === editOriginal && !url) undoStack.pop();
    commit();
  }
  function cancelEdit() {
    if (!editingId) return;
    const n = nodes.get(editingId);
    editor.style.display = 'none'; editingId = null;
    undoStack.pop();
    if (editOriginal === '' && (!isRoot(n) || roots().length > 1)) {
      // 新規に作って空のままやめた場合は消す。作成時の取り消し記録はそのまま残す。
      deleteNode(n.id, false); return;
    }
    n.text = editOriginal; commit();
  }
  editor.addEventListener('input', () => {
    if (!editingId) return;
    nodes.get(editingId).text = editor.textContent.replace(/[\r\n]/g, '');
    layout(); requestDraw();
  });
  editor.addEventListener('blur', () => finishEdit());

  // ---------- 座標 ----------
  function toWorld(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return { x: (clientX - r.left - view.tx) / view.s, y: (clientY - r.top - view.ty) / view.s };
  }
  function zoomAt(clientX, clientY, factor) {
    const r = svg.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const ns = Math.min(3, Math.max(MIN_SCALE, view.s * factor));
    view.tx = px - (px - view.tx) * (ns / view.s); view.ty = py - (py - view.ty) * (ns / view.s); view.s = ns;
    requestDraw();
  }
  function fitView() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes.values()) {
      if (n.hidden) continue;
      minX = Math.min(minX, n.cx - n.w / 2); maxX = Math.max(maxX, n.cx + n.w / 2);
      minY = Math.min(minY, n.cy - n.h / 2); maxY = Math.max(maxY, n.cy + n.h / 2);
    }
    for (const b of boards) {
      minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + b.w);
      minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.h);
    }
    const W = vw(), H = vh();
    const s = Math.min(1.5, (W - 120) / Math.max(1, maxX - minX), (H - 120) / Math.max(1, maxY - minY));
    view.s = Math.max(MIN_SCALE, s);
    view.tx = W / 2 - view.s * (minX + maxX) / 2; view.ty = H / 2 - view.s * (minY + maxY) / 2;
    requestDraw();
  }

  // ---------- ドラッグ・パン ----------
  // 中心ノードは自由に置ける。ほかのノードは位置を持たない。離した場所で付け替えか並べ替えをし、配置は自動に任せる。
  const NO_OFFSET = { x: 0, y: 0 };
  function dragOffset(n) { return drag && drag.sub && drag.sub.has(n.id) ? drag.off : NO_OFFSET; }
  // 点 (x, y) に重なったノードの子にする。左右は親子の間の半分まで広く取る。
  // 上下は広げない。兄弟の間（VGAP）は並べ替えの当たりに残す。
  const DROP_MARGIN_X = HGAP / 2;
  function childDropAt(x, y, exclude) {
    let best = null, bestD = Infinity;
    for (const c of nodes.values()) {
      if (exclude.has(c.id) || c.hidden) continue;
      if (Math.abs(x - c.cx) > c.w / 2 + DROP_MARGIN_X || Math.abs(y - c.cy) > c.h / 2) continue;
      const d = Math.hypot(c.cx - x, c.cy - y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) return null;
    // 片側だけのマップの中心ノードに重ねたときは、その側に付ける
    const fixed = isRoot(best) && layoutOf(best) !== 'both' ? layoutOf(best) : null;
    return { parentId: best.id, side: fixed || (x < best.cx ? 'left' : 'right'), beforeId: null, afterId: null };
  }
  // 中心ノードの横の、まだ枝のない側に置く。左右の移動で、反対側が空のときに使う。
  function sideDropAt(x, y, exclude) {
    for (const r of roots()) {
      if (exclude.has(r.id)) continue;
      const dir = x < r.cx ? -1 : 1, gap = dir * (x - r.cx) - r.w / 2;
      if (gap < 0 || gap > HGAP + 260 || Math.abs(y - r.cy) > 120) continue;
      const side = dir < 0 ? 'left' : 'right';
      if (r.children.some(id => !exclude.has(id) && nodes.get(id).side === side)) continue;
      const inner = r.cx + dir * (r.w / 2 + HGAP), outer = inner + dir * MIN_W * 2;
      return { parentId: r.id, side, beforeId: null, afterId: null,
        line: { x1: Math.min(inner, outer), x2: Math.max(inner, outer), y1: r.cy, y2: r.cy } };
    }
    return null;
  }
  // 点 (x, y) を兄弟の列の間に入れる。いちばん近い兄弟の列を選び、上下どこに入るかを決める。
  function insertDropAt(x, y, exclude) {
    let near = null, nearD = Infinity;
    for (const s of nodes.values()) {
      if (exclude.has(s.id) || s.hidden || isRoot(s)) continue;
      if (Math.abs(x - s.cx) > s.w / 2 + HGAP / 2) continue;
      const d = Math.abs(y - s.cy);
      if (d < nearD) { nearD = d; near = s; }
    }
    if (!near || nearD > NODE_H * 1.5 + VGAP) return null;
    const p = nodes.get(near.parentId);
    const dir = Math.sign(near.cx - p.cx) || 1;
    const sibs = p.children.map(id => nodes.get(id))
      .filter(k => !exclude.has(k.id) && (Math.sign(k.cx - p.cx) || 1) === dir).sort((a, b) => a.cy - b.cy);
    const i = sibs.findIndex(k => k.cy > y);
    const before = i < 0 ? null : sibs[i], after = i < 0 ? sibs[sibs.length - 1] : sibs[i - 1] || null;
    const ly = before && after ? (after.cy + after.h / 2 + before.cy - before.h / 2) / 2
      : before ? before.cy - before.h / 2 - VGAP / 2 : after.cy + after.h / 2 + VGAP / 2;
    const inner = p.cx + dir * (p.w / 2 + HGAP);
    const outer = inner + dir * Math.max(...sibs.map(k => k.w), MIN_W);
    return { parentId: p.id, side: dir < 0 ? 'left' : 'right', beforeId: before && before.id, afterId: after && after.id,
      line: { x1: Math.min(inner, outer), x2: Math.max(inner, outer), y1: ly, y2: ly } };
  }
  svg.addEventListener('contextmenu', e => {
    const g = e.target.closest && e.target.closest('.node');
    if (!g || readOnly) return;
    e.preventDefault();
    if (editingId) finishEdit();
    finishBoardEdit();
    closeLinkEditor();
    selectedId = g.dataset.id;
    selectedBoardId = null;
    openNodeMenu(g.dataset.id, e.clientX, e.clientY);
    requestDraw();
  });
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const g = e.target.closest && e.target.closest('.node');
    const w = toWorld(e.clientX, e.clientY);
    // ボードは名前で動かし、角で大きさを変える。ボードの内側の余白は背景と同じに扱う
    const bt = !readOnly && !g && e.target.closest && e.target.closest('.board-title, .board-handle');
    if (bt) {
      finishEdit(); finishBoardEdit();
      const b = boardById(bt.closest('.board').dataset.id);
      // 範囲選択に入っているボードの名前をつかむと、選んだものをまとめて動かす
      if (multiActive() && multi.boards.has(b.id)) { startGroupDrag(e, w, { boardId: b.id }); return; }
      selectBoard(b.id);
      boardDrag = { b, corner: bt.dataset.corner || null, startX: e.clientX, startY: e.clientY, start: w,
        orig: { x: b.x, y: b.y, w: b.w, h: b.h }, moved: false, roots: [], inner: [] };
      svg.setPointerCapture(e.pointerId);
      requestDraw();
      return;
    }
    closeLinkEditor();
    // リンクは ↗ か、⌘ を押しながらのクリックで開く
    if (g && (e.target.closest('.link-open') || ((e.metaKey || e.ctrlKey) && nodes.get(g.dataset.id).url))) { openLink(g.dataset.id); return; }
    // macOS では Ctrl クリックが右クリックになる。ノード上ではメニューに任せて、ドラッグにはしない
    if (g && e.ctrlKey) return;
    if (g && e.target.closest('.toggle')) { if (!readOnly) { finishEdit(); toggleCollapse(g.dataset.id); } return; }
    if (g && readOnly) { selectedId = g.dataset.id; requestDraw(); return; }
    if (g) {
      const n = nodes.get(g.dataset.id);
      if (editingId && editingId !== n.id) finishEdit();
      if (editingId === n.id) return;
      // 範囲選択に入っているノードをつかむと、選んだものをまとめて動かす。
      // そのノードのマップの中心ノードも選んでいればマップごと、そうでなければ選んだ枝をまとめて付け替える
      const group = multiActive() && multi.nodes.has(n.id);
      if (group && multi.nodes.has(rootOf(n).id)) { startGroupDrag(e, w, { nodeId: n.id }); return; }
      drag = { id: n.id, startX: e.clientX, startY: e.clientY, grabDX: n.cx - w.x, grabDY: n.cy - w.y, moved: false,
        sub: null, off: NO_OFFSET, drop: null, group: group ? multiTops().filter(t => !isRoot(t)).map(t => t.id) : null };
      if (!group) { selectedId = n.id; selectedBoardId = null; }
      requestDraw();
    } else {
      finishEdit(); finishBoardEdit();
      if (e.shiftKey) {
        // ⇧ を押しながら背景をドラッグすると、範囲を選ぶ
        marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, startX: e.clientX, startY: e.clientY, moved: false };
        svg.classList.add('selecting');
      } else {
        pan = { startX: e.clientX, startY: e.clientY, tx: view.tx, ty: view.ty, moved: false };
        svg.classList.add('panning');
      }
    }
    svg.setPointerCapture(e.pointerId);
  });
  // 範囲選択したマップ（中心ノード）とボードを、まとめて動かし始める。ボードの中にあるマップとボードもついてくる。
  // 動かさずに離したら、つかんだものだけを選ぶ（click）。
  function startGroupDrag(e, w, click) {
    boardDrag = { b: null, group: true, click, corner: null, startX: e.clientX, startY: e.clientY, start: w,
      orig: null, moved: false, roots: [], inner: [] };
    svg.setPointerCapture(e.pointerId);
    requestDraw();
  }
  svg.addEventListener('pointermove', e => {
    if (marquee) {
      const m = marquee;
      if (!m.moved && Math.hypot(e.clientX - m.startX, e.clientY - m.startY) < 3) return;
      m.moved = true;
      const w = toWorld(e.clientX, e.clientY);
      m.x1 = w.x; m.y1 = w.y;
      requestDraw();
    } else if (boardDrag) {
      const d = boardDrag, b = d.b, o = d.orig;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
        d.moved = true;
        pushUndo();
        if (d.group) {
          const sel = boards.filter(q => multi.boards.has(q.id));
          const bs = new Set(sel), rs = new Set(multiTops().filter(isRoot));
          for (const q of sel) for (const r of boards) if (boardInside(q, r)) bs.add(r);
          for (const r of roots()) if (sel.some(q => boardContains(q, r.dx, r.dy))) rs.add(r);
          d.inner = [...bs].map(q => ({ q, x: q.x, y: q.y }));
          d.roots = [...rs].map(r => ({ r, x: r.dx, y: r.dy }));
        } else if (!d.corner) {
          d.roots = roots().filter(r => boardContains(o, r.dx, r.dy)).map(r => ({ r, x: r.dx, y: r.dy }));
          d.inner = boards.filter(q => boardInside(b, q)).map(q => ({ q, x: q.x, y: q.y }));
        }
      }
      const w = toWorld(e.clientX, e.clientY);
      const mx = w.x - d.start.x, my = w.y - d.start.y;
      if (d.corner) {
        // 反対の角を固定して大きさを変える。中のマップは動かさない
        let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
        if (d.corner.includes('w')) x1 = Math.min(x1 + mx, x2 - BOARD_MIN_W); else x2 = Math.max(x2 + mx, x1 + BOARD_MIN_W);
        if (d.corner.includes('n')) y1 = Math.min(y1 + my, y2 - BOARD_MIN_H); else y2 = Math.max(y2 + my, y1 + BOARD_MIN_H);
        Object.assign(b, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      } else {
        if (b) { b.x = o.x + mx; b.y = o.y + my; }
        for (const it of d.inner) { it.q.x = it.x + mx; it.q.y = it.y + my; }
        for (const it of d.roots) { it.r.dx = it.x + mx; it.r.dy = it.y + my; }
        layout();
        // 中のマップはボードに遅れずについてくる
        for (const it of d.roots) for (const id of subtreeIds(it.r)) { const n = nodes.get(id); n.vx = n.cx; n.vy = n.cy; }
      }
      requestDraw();
    } else if (drag) {
      const n = nodes.get(drag.id); if (!n) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
        drag.moved = true;
        if (isRoot(n)) pushUndo();
        else if (drag.group) { drag.sub = new Set(); for (const id of drag.group) subtreeIds(nodes.get(id), drag.sub); }
        else drag.sub = subtreeIds(n);
      }
      const w = toWorld(e.clientX, e.clientY);
      const tx = w.x + drag.grabDX, ty = w.y + drag.grabDY;
      const exclude = drag.sub || subtreeIds(n);
      if (isRoot(n)) {
        n.dx = tx; n.dy = ty;
        layout(); n.vx = n.cx; n.vy = n.cy;
        // 中心ノードは Shift を押しながら重ねたときだけ、別のマップの枝になる
        drag.drop = e.shiftKey ? childDropAt(tx, ty, exclude) : null;
      } else {
        // 枝ごとポインタについて動かす。モデルの位置は変えない
        drag.off = { x: tx - n.cx, y: ty - n.cy };
        for (const id of drag.sub) { const k = nodes.get(id); k.vx = k.cx + drag.off.x; k.vy = k.cy + drag.off.y; }
        drag.drop = childDropAt(tx, ty, exclude) || insertDropAt(tx, ty, exclude) || sideDropAt(tx, ty, exclude);
      }
      requestDraw();
    } else if (pan) {
      if (!pan.moved && Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY) < 3) return;
      pan.moved = true;
      view.tx = pan.tx + (e.clientX - pan.startX); view.ty = pan.ty + (e.clientY - pan.startY);
      requestDraw();
    }
  });
  function endPointer(e, cancelled = false) {
    if (marquee) {
      const m = marquee;
      marquee = null;
      svg.classList.remove('selecting');
      if (!m.moved) { selectedId = null; selectedBoardId = null; clearMulti(); }
      else if (!cancelled) selectInRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.max(m.x0, m.x1), Math.max(m.y0, m.y1));
      requestDraw();
    }
    if (boardDrag) {
      const d = boardDrag;
      boardDrag = null;
      if (d.moved) commit();
      else if (d.group && !cancelled) { if (d.click.nodeId) selectedId = d.click.nodeId; else selectBoard(d.click.boardId); }
      requestDraw();
    }
    if (drag) {
      const n = nodes.get(drag.id);
      const d = drag;
      drag = null;
      if (d.moved && n) {
        if (d.drop && !cancelled) { if (d.group) moveMany(d.group, d.drop); else moveTo(n.id, d.drop, !isRoot(n)); }
        else if (isRoot(n)) commit();
      } else if (d.group && n && !cancelled) selectedId = n.id;
      requestDraw();
    }
    if (pan) {
      if (!pan.moved) { selectedId = null; selectedBoardId = null; clearMulti(); requestDraw(); }
      pan = null; svg.classList.remove('panning');
    }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', e => endPointer(e, true));
  svg.addEventListener('dblclick', e => {
    // pointerdown で svg にポインタを捕捉しているので、e.target は svg になる。座標から要素を引き直す
    const hit = root.elementFromPoint(e.clientX, e.clientY) || e.target;
    const g = hit.closest && hit.closest('.node');
    if (readOnly || (g && hit.closest('.toggle, .link-open'))) return;
    const bt = !g && hit.closest && hit.closest('.board-title');
    if (bt) { e.preventDefault(); startBoardEdit(bt.closest('.board').dataset.id); return; }
    if (g) { e.preventDefault(); startEdit(g.dataset.id); }
    else if (!g) { e.preventDefault(); const w = toWorld(e.clientX, e.clientY); addRoot(w.x, w.y); }
  });
  svg.addEventListener('wheel', e => {
    closeNodeMenu();
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    else { view.tx -= e.deltaX; view.ty -= e.deltaY; requestDraw(); }
  }, { passive: false });

  // ---------- キーボード ----------
  function navigate(key) {
    const n = nodes.get(selectedId); if (!n) return;
    const p = n.parentId ? nodes.get(n.parentId) : null;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      if (!p) return;
      const sib = p.children.map(id => nodes.get(id)).filter(k => Math.sign(k.cx - p.cx) === Math.sign(n.cx - p.cx))
        .sort((a, b) => a.cy - b.cy);
      const i = sib.indexOf(n);
      const t = sib[i + (key === 'ArrowDown' ? 1 : -1)];
      if (t) selectedId = t.id;
    } else {
      const dir = key === 'ArrowRight' ? 1 : -1;
      const kids = n.children.map(id => nodes.get(id)).filter(k => !k.hidden && Math.sign(k.cx - n.cx) === dir)
        .sort((a, b) => Math.abs(a.cy - n.cy) - Math.abs(b.cy - n.cy));
      if (kids.length) selectedId = kids[0].id;
      else if (p && Math.sign(p.cx - n.cx) === dir) selectedId = p.id;
    }
    requestDraw();
  }
  host.addEventListener('keydown', e => {
    const t = tgt(e);
    // メニューが開いているあいだは、ノードの削除や編集にキーを渡さない
    if (nodeMenu.classList.contains('show') && !(t.closest && t.closest('#node-menu'))) {
      closeNodeMenu();
      e.preventDefault();
      return;
    }
    if (t.closest && t.closest('.popover, .context-menu')) return;
    const meta = e.metaKey || e.ctrlKey;
    if (editingId) {
      // 日本語入力の変換中や確定の Enter・Esc・Tab は IME に任せる。Safari は確定の Enter で isComposing が false になるので keyCode も見る
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(); }
      else if (e.key === 'Tab') { e.preventDefault(); const id = editingId; finishEdit(); addChild(id); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      return;
    }
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!readOnly) e.shiftKey ? redo() : undo(); return; }
    if (meta && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomAt(vw() / 2, vh() / 2, 1.2); return; }
    if (meta && e.key === '-') { e.preventDefault(); zoomAt(vw() / 2, vh() / 2, 1 / 1.2); return; }
    if (meta && e.key === '0') { e.preventDefault(); fitView(); return; }
    if (meta && e.key === 'Enter') { e.preventDefault(); if (selectedId) openLink(selectedId); return; }
    // 閲覧のみでは、移動と表示とコピーだけ受ける
    if (readOnly) {
      if (e.key.startsWith('Arrow') && !meta && selectedId) { e.preventDefault(); navigate(e.key); }
      else if (meta && !e.altKey && ['c', 'x'].includes(e.key.toLowerCase())) onClipKey(e.key.toLowerCase());
      else if (e.key === 'Escape') { selectedId = null; clearMulti(); requestDraw(); }
      else if (e.key === 'Tab' && !selectedId) { e.preventDefault(); selectedId = roots()[0].id; requestDraw(); }
      return;
    }
    if (meta && e.key === '.') { e.preventDefault(); if (selectedId) toggleCollapse(selectedId); return; }
    if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openLinkEditor(); return; }
    if (meta && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); if (selectedId) setSide(selectedId, e.key === 'ArrowLeft' ? 'left' : 'right'); return;
    }
    if (meta && !e.altKey && ['c', 'x', 'v'].includes(e.key.toLowerCase())) { onClipKey(e.key.toLowerCase()); return; }
    if (meta) return;
    if (multiActive()) {
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteMulti(); }
      else if (e.key === 'Escape') { clearMulti(); requestDraw(); }
      return;
    }
    if (selectedBoardId) {
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); removeBoard(selectedBoardId); }
      else if (e.key === 'Enter') { e.preventDefault(); startBoardEdit(selectedBoardId); }
      else if (e.key === 'Escape') { selectedBoardId = null; requestDraw(); }
      return;
    }
    if (!selectedId) { if (e.key === 'Tab') { e.preventDefault(); selectedId = roots()[0].id; requestDraw(); } return; }
    switch (e.key) {
      case 'Tab': e.preventDefault(); addChild(selectedId); break;
      case 'Enter': e.preventDefault(); addSibling(selectedId); break;
      case 'Backspace': case 'Delete': e.preventDefault(); deleteNode(selectedId); break;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': e.preventDefault(); navigate(e.key); break;
      case 'Escape': selectedId = null; requestDraw(); break;
      case ' ': e.preventDefault(); startEdit(selectedId); break;
      default:
        if (e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(selectedId, e.key); }
    }
  });

  // ---------- ツールバー ----------
  $('btn-add-board').addEventListener('click', addBoard);
  linkButton.addEventListener('click', openLinkEditor);
  $('btn-zoom-in').addEventListener('click', () => zoomAt(vw() / 2, vh() / 2, 1.2));
  $('btn-zoom-out').addEventListener('click', () => zoomAt(vw() / 2, vh() / 2, 1 / 1.2));
  $('btn-fit').addEventListener('click', fitView);
  // 配置のボタンは、選択中のノードが属するマップに効く
  for (const b of layoutButtons) b.addEventListener('click', () => {
    const sel = nodes.get(selectedId);
    if (sel) setLayout(rootOf(sel).id, b.dataset.layout);
  });
  // 枝のボタンは、選択中のノードを含む枝（中心ノードの子）を左右へ動かす
  for (const b of sideButtons) b.addEventListener('click', () => selectedId && setSide(selectedId, b.dataset.side));
  root.querySelectorAll('button').forEach(b => b.addEventListener('pointerdown', e => e.preventDefault()));
  // Esc は、開いているメニューとリンクの入力を先に閉じる。文字の編集中は編集のほうを取りやめる。
  host.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !editingId && !editingBoardId && !e.isComposing && (closeNodeMenu() || closeLinkEditor())) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  // メニューの外を押したら閉じる。キャンバスを押したら、キー操作を受けられるよう部品にフォーカスを移す
  root.addEventListener('pointerdown', e => {
    if (nodeMenu.classList.contains('show') && !nodeMenu.contains(tgt(e))) closeNodeMenu();
    if (svg.contains(tgt(e)) && !root.activeElement) host.focus({ preventScroll: true });
  }, true);
  new ResizeObserver(() => { closeNodeMenu(); requestDraw(); }).observe(host);
  // 中身が入るまで（store が渡されるまで）は何も描かない
  view = { tx: 0, ty: 0, s: 1 };

  return {
    setStore, setReadOnly, fit: fitView,
    /** 開いているメニューやリンクの入力を閉じる。閉じたら true */
    closeOverlays: () => closeNodeMenu() || closeLinkEditor(),
    getMap: () => serialize(),
    flush,
  };
}

/** <mind-map> 要素。 */
export class MindMapElement extends HTMLElement {
  static observedAttributes = ['readonly'];
  #api; #store = null;
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open', delegatesFocus: false });
    root.innerHTML = `<style>${CSS}</style>${MARKUP}`;
    this.#api = mount(this, root);
  }
  connectedCallback() { if (!this.hasAttribute('tabindex')) this.tabIndex = 0; }
  attributeChangedCallback(name, _old, value) { if (name === 'readonly') this.#api.setReadOnly(value !== null); }
  get store() { return this.#store; }
  set store(s) { this.#store = s || null; this.#api.setStore(this.#store); }
  get readOnly() { return this.hasAttribute('readonly'); }
  set readOnly(v) { this.toggleAttribute('readonly', !!v); }
  /** 全体が入るように表示する。 */
  fit() { this.#api.fit(); }
  closeOverlays() { return this.#api.closeOverlays(); }
  /** 今のマップ（保存する形）。 */
  get map() { return this.#api.getMap(); }
  /** 待っている書き込みをすぐ送る。 */
  flush() { return this.#api.flush(); }
}

/** <mind-map>（または別の名前）を登録する。何度呼んでもよい。 */
export function defineMindMap(name = 'mind-map') {
  if (!customElements.get(name)) customElements.define(name, class extends MindMapElement {});
}
