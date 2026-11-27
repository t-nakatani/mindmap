# packages: 配れるマインドマップ部品

マインドマップを、どのアプリにも組み込める部品として切り出したもの。部品はデータの置き場もログインも知らず、使う側が store を渡す。

| パッケージ | 中身 | 動く場所 |
| --- | --- | --- |
| `mindmap-element` | Web Component `<mind-map>`（Shadow DOM、依存なし）と `httpStore`・`memoryStore` | ブラウザ |
| `mindmap-core` | マップの形・正規化・ノードの解決・操作（`ops`）・箇条書きの読み書き | どこでも（依存なし） |
| `mindmap-server` | 保存側 `MindmapMaps`。使う側の Durable Object の中に置き、`httpStore` の API を受ける | Cloudflare Durable Object（SQLite） |

## 使い方（ブラウザ）

```html
<mind-map id="m" root-title="11/27（金）" style="height: 360px"></mind-map>
<script type="module">
  import { defineMindMap, httpStore, memoryStore } from './mindmap-element/index.js';
  defineMindMap();                       // 'mind-map' で登録（名前は変えられる）
  const m = document.getElementById('m');
  m.store = httpStore({ base: '/api/mindmap', name: 'daily-2026-11-27' });
  // 保存しないで試すとき: m.store = memoryStore();
  m.addEventListener('mindmap-change', e => console.log(e.detail.map));
</script>
```

- 属性: `readonly`（閲覧のみ）、`root-title`（空のマップを作るときの中心ノードの文字）
- プロパティ・メソッド: `store`（差し替えると前の store の書きかけを送ってから読み直す）、`map`（今のマップ）、`fit()`、`flush()`
- イベント: `mindmap-change`（`detail.map`）
- キー操作はフォーカスが要素の中にあるときだけ効く。ページの入力欄とぶつからない。色は `:host` の CSS 変数（`--color-*` など）で上書きできる。

## store の約束

```ts
interface MindmapStore {
  load(): Promise<{ map: MindMap; version: number } | null>;
  save(map: MindMap, baseVersion: number): Promise<{ ok: true; version: number } | { conflict: true; map: MindMap; version: number } | { error: string }>;
  subscribe?(cb: (got: { map: MindMap; version: number }) => void): () => void;  // ほかの画面・CLI の変更を受ける
  unfurl?(url: string): Promise<LinkMeta | null>;                                 // リンクの題名など
}
```

版番号で楽観ロックする。`save` は読み込んだ版を `baseVersion` に添え、先に別の書き込みがあれば `conflict` と最新を返す（部品が取り込む）。
HTTP 以外（MCP Apps の `callServerTool`、localStorage、ほかの DB）も、この形を返せばそのまま使える。

## 保存側（Cloudflare）

```ts
import { MindmapMaps } from '../packages/mindmap-server/src/index.ts';
export class MyStore extends DurableObject {
  maps = new MindmapMaps(this.ctx);   // 表は mm_maps・mm_links（prefix で変えられる）
  async fetch(req: Request) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/mindmap/')) return this.maps.handle(req, path.slice('/api/mindmap'.length));
    return new Response('not found', { status: 404 });
  }
}
```

ログインと「誰のデータか」は使う側が決める（Durable Object を人ごとに分けるなど）。使い方の例は `apps/daily`。

## これから

- 本体（`public/index.html`）のキャンバスも `<mind-map>` に置き換え、同じ部品を使う。
- npm に出す。そのときは `mindmap-server` から `mindmap-core` への相対 import をパッケージ名に替え、`mindmap-element` の `normalize` などを `mindmap-core` から取るようにする。
