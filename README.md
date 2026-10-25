# マインドマップ

MindNode の「ノードの生え方」を Web で再現したマインドマップ。ページは `public/index.html` 1ファイルで、依存はない。
裏側は Cloudflare の Worker 1つと Durable Object 1つ。CLI から同じマップを動かせるので、エージェントも使える。

## 動かし方（手元）

Node 23.6 以上（CLI の TypeScript をそのまま動かすため）。

```sh
npm install
npm run dev
```

ブラウザで http://127.0.0.1:4381 を開く。手元では認証はない。データは `.wrangler/state/` に入る。

エージェントや端末からは CLI で操作する。使い方は [AGENTS.md](AGENTS.md) に書いた。

```sh
node cli.ts show
node cli.ts add "予算" --under 中心テーマ
node cli.ts import outline.md --replace
```

## ファイル時代のマップを移す

以前の Node サーバーは `data/<マップ名>.json` と `data/.current` にマップを置いていた。これをサーバーへ移す。

```sh
node cli.ts migrate ~/dev/apps/mindmap-prototype/data            # 同じ名前のマップがあれば飛ばす
node cli.ts migrate ~/dev/apps/mindmap-prototype/data --replace  # 同じ名前のマップを上書きする
```

画面を先に開くと、空のサーバーに `map` が自動で作られ、移すときに飛ばされる。その場合は `--replace` を付ける。
デプロイ先へ移すときは、`MINDMAP_URL` とサービストークン（下記）を設定してから同じコマンドを使う。

## デプロイ（Cloudflare）

本人の個人アカウントに置く。会社のアカウントは使わない。`npx wrangler whoami` で確かめてから進める。

1. `npm run deploy` で Worker と Durable Object を作る。
2. Zero Trust で Access のアプリケーションを作り、Worker のホストを守る。
   - ブラウザ用のポリシー: 本人のメールアドレスだけを許可する。
   - CLI とエージェント用: サービストークンを作り、そのトークンを「Service Auth」で許可するポリシーを足す。
3. `wrangler.jsonc` の `ACCESS_TEAM_DOMAIN`（`<チーム>.cloudflareaccess.com`）と `ACCESS_AUD`（アプリケーションの AUD）を入れて、もう一度デプロイする。
   この2つが空のあいだ、Worker は手元（localhost）以外からの `/api/` をすべて断る。
4. CLI に `MINDMAP_URL`、`MINDMAP_ACCESS_CLIENT_ID`、`MINDMAP_ACCESS_CLIENT_SECRET` を設定する。

Worker は Access が付ける JWT（`Cf-Access-Jwt-Assertion`）の署名・AUD・発行元・期限を確かめる。ページ自体はデータを含まないので守らなくても漏れないが、Access はホスト全体に掛ける。

## できること

- Tab で子ノード、Enter で兄弟ノードを追加する。中心ノードで Enter を押すと子になる。
- 中心ノードを複数置ける。背景をダブルクリックすると、その位置に新しいマップができる。中心ノードを Delete するとマップごと消える（最後の1つは残る）。
- 中心ノードは自由にドラッグして並べられる。Shift を押しながら別のノードに重ねると、そのマップの枝になる。
- マップごとに配置を「両側」「右」「左」から選べる。ノードを選んでツールバーの「配置」で切り替える。両側では中心ノードの子を左右に交互に振り分ける。枝ごとに色が付く。
- 枝ごとに左右を決められる。ノードを選んでツールバーの「枝」か ⌘← / ⌘→ で、そのノードを含む枝を中心の左右へ動かす。片側だけのマップで反対側へ出すと、そのマップは両側になる。
- 中心ノード以外は自動で配置する。ドラッグすると枝ごとついて動き、兄弟の間に離すと並べ替え、中心ノードの反対側に離すとそちらへ移し（枝のない側なら中心の横に離す）、別のノードに重ねて離すとその子に付け替える。入る位置には線が出る。どこにも当たらなければ元に戻る。
- 線はベジェ曲線で、階層が深いほど細くなる。配置が変わると線とノードがアニメーションで追従する。
- 背景のドラッグとスクロールで移動する。ピンチと ⌘+スクロールで拡大縮小する。
- 文字キーで選択中のノードを書き換える。ダブルクリックで編集する。Escape で取り消す。
- ⌘. か、ノードの外側に出る丸をクリックすると枝を折りたたむ。折りたたんだノードには子孫の数が出る。折りたたんだノードに Tab で子を足すと自動で開く。
- Delete で削除、⌘Z で取り消し、⌘⇧Z でやり直し、⌘0 で全体を表示する。
- マップを複数持てる。ツールバー左端のセレクトで切り替え、「マップを追加」で新しいマップを作る。選択は CLI の `use` と共通で、どちらで切り替えても画面と CLI の対象が揃う。
- CLI からの変更は WebSocket で即時に反映され、⌘Z で取り消せる。接続が切れたらつなぎ直し、その間の変更を取り込む。
- 保存は版番号つき。別の場所で先に書かれていたら上書きせず、サーバーの最新を取り込む（自分の変更は ⌘Z で戻せる）。
- サーバーがないときは localStorage だけに保存して動く。

## 中身

- `public/index.html`: データは `nodes`（Map）。親のないノードが中心ノードで、`dx, dy` が位置。`layout()` が目標位置を決め、`frame()` が表示位置を補間し、`draw()` が SVG を更新する。操作の前に `pushUndo()` で状態を JSON で積む。
- `src/worker.ts`: 入口。`/api/` の認証（Cloudflare Access の JWT）と、Durable Object への受け渡し。
- `src/store.ts`: Durable Object。全マップと今選んでいるマップを SQLite に持つ。`GET/PUT /api/map?name=`、`GET/POST /api/maps`、`PUT /api/current`、`POST /api/op`、`POST /api/import`、`GET /api/ws`（WebSocket）。書き込みは同期の SQL だけで行うので、順に処理される。
- `lib/map.ts` と `lib/ops.ts`: 名前・ID・経路でノードを指して追加・改名・移動・削除・折りたたみ、Markdown の箇条書きの取り込みと書き出し。Durable Object と CLI が共有する。
- `cli.ts`: API を呼ぶ CLI。

## まだないもの

- OPML や `.mindnode` との相互変換（`.mindnode` の取り込みは一度だけ手元のスクリプトで行った）
- 枝を画面上で切り離して独立したマップにする操作（CLI の `move --root` ではできる）
- 複数選択とコピー・ペースト
- マップどうしの重なり回避
- 同時編集の細かいマージ（衝突したら後から書いたほうが最新を取り込み直す）
- マップの削除と改名（画面と CLI のどちらにもない）
