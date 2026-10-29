# マインドマップ

MindNode の「ノードの生え方」を Web で再現したマインドマップ。ページは `public/index.html` 1ファイルで、依存はない。
裏側は Cloudflare の Worker 1つと Durable Object 1つ。CLI から同じマップを動かせるので、エージェントも使える。

## 動かし方（手元）

CLI は Node 23.6 以上（TypeScript をそのまま動かすため）。開発サーバーとデプロイは Cloudflare の CLI `cf` を使い、`cf` は Node 26.12 以上が要る。
このプロジェクトは `mise.toml` で Node 26.12.1 に固めてあり、`npm run dev` などの scripts は `mise exec` 経由で `cf` を呼ぶ。

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
`data/` はリポジトリの中にあり、git の対象外。2026-10-25 にデプロイ先へ移し終え、今は控えとして残している。

```sh
node cli.ts migrate              # data/ を移す。同じ名前のマップがあれば飛ばす
node cli.ts migrate --replace    # 同じ名前のマップを上書きする
```

画面を先に開くと、空のサーバーに `map` が自動で作られ、移すときに飛ばされる。その場合は `--replace` を付ける。
デプロイ先へ移すときは、`MINDMAP_URL` と `MINDMAP_TOKEN`（下記）を設定してから同じコマンドを使う。

## デプロイ（Cloudflare）

本人の個人アカウントに置く。会社のアカウントは使わない。`cloudflare.config.ts` の `accountId` で個人アカウントに固めてある。
`cf` のログインは profile で分けている。このフォルダには個人アカウントの profile `personal` を結び付けてある。

```sh
mise exec -- npx cf auth whoami     # tomoya.12@icloud.com と出ることを確かめる
mise exec -- npx cf auth create personal && mise exec -- npx cf auth activate personal   # ログインが切れたとき
```

本番の Durable Object に全マップがある。設定を変えてデプロイするときは、先にマップを控え（`/api/maps` と各 `/api/map` を JSON で保存する）、dry-run を通してから上げる。

```sh
mise exec -- npx cf deploy --dry-run   # 何も上げずに、ビルドと binding を確かめる
npm run deploy                         # https://mindmap.tomoya-12.workers.dev
```

ログインは Knowledge Box と同じ形にした。ブラウザは Google でログインし（OpenID Connect、PKCE・state・nonce つき）、
確認済みのメールアドレスが `ALLOWED_EMAILS` にあればセッションの cookie を出す。CLI とエージェントは `API_TOKEN` を
`Authorization: Bearer` に付ける。設定はすべて Worker の secret で入れる。

- `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`: Google Cloud の OAuth クライアント（ウェブ アプリケーション）
- `ALLOWED_EMAILS`: ログインを通すアドレス。カンマ区切り
- `API_TOKEN`: CLI 用。長い乱数にする

secret を入れ直すときは、値を `.env` 形式で書いたファイルをリポジトリの外に置き、デプロイと一緒に上げる。終わったらファイルは消す。

```sh
mise exec -- npx cf deploy --secrets-file ~/mindmap-secrets.env
```

OAuth クライアントの「承認済みのリダイレクト URI」には次の2つを入れる。

- `https://mindmap.tomoya-12.workers.dev/api/auth/google/callback`
- `http://127.0.0.1:4381/api/auth/google/callback`（手元で Google ログインを試すとき）

CLI は `~/.config/mindmap/env` に `MINDMAP_URL` と `MINDMAP_TOKEN`（`API_TOKEN` と同じ値）を書いておけば、そのつなぎ先を使う。
手元で Google ログインを試すときは `.dev.vars.example` を `.dev.vars` にコピーして値を入れる。`GOOGLE_CLIENT_ID` が無ければ、手元は認証なしで動く。

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
- ⌘X / ⌘C でノードを子孫ごと切り取り / コピーし、⌘V で選択中のノードの子として貼り付ける。選択がなければ画面の真ん中に新しいマップとして置く。別のマップへ切り替えてから貼れば、マップをまたいで移せる。クリップボードには箇条書きで入るので、ほかのアプリへも貼れ、ほかのアプリの箇条書きや文字を貼るとノードになる。
- マップを複数持てる。ツールバー左端のセレクトで切り替え、「マップを追加」で新しいマップを作る。選択は CLI の `use` と共通で、どちらで切り替えても画面と CLI の対象が揃う。
- CLI からの変更は WebSocket で即時に反映され、⌘Z で取り消せる。接続が切れたらつなぎ直し、その間の変更を取り込む。
- 保存は版番号つき。別の場所で先に書かれていたら上書きせず、サーバーの最新を取り込む（自分の変更は ⌘Z で戻せる）。
- サーバーがないときは localStorage だけに保存して動く。

## 中身

- `public/index.html`: データは `nodes`（Map）。親のないノードが中心ノードで、`dx, dy` が位置。`layout()` が目標位置を決め、`frame()` が表示位置を補間し、`draw()` が SVG を更新する。操作の前に `pushUndo()` で状態を JSON で積む。
- `src/worker.ts`: 入口。`/api/` を Durable Object へ渡す。
- `src/auth.ts`: Google ログインとセッション、API トークンの確認。Durable Object の中で動く。
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
