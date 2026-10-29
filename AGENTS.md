# エージェント向け: このマインドマップの動かし方

このリポジトリは、ブラウザで動くマインドマップと、それを操作する CLI です。裏側は Cloudflare の Worker と Durable Object です。
エージェントは **CLI だけ** でマップを読み書きします。CLI は API を呼び、書き込みはサーバー側で順に行われます。
CLI の変更はブラウザに即時に（WebSocket で）反映されます。人がブラウザで動かした内容も同じところに入ります。

## つなぎ先

```sh
npm run dev                # 手元の開発サーバー http://127.0.0.1:4381（認証なし）
```

CLI は既定で手元の開発サーバーにつなぎます。デプロイ先を使うときは `~/.config/mindmap/env` に書きます（環境変数でも同じ。環境変数が優先）。

```sh
MINDMAP_URL=https://mindmap.tomoya-12.workers.dev
MINDMAP_TOKEN=<API トークン>
```

`ログインしていません` と出たら、`MINDMAP_TOKEN` を確かめてください。トークンの値は出力に書かないでください。

## 領域と共有

マップはログインする Google アカウントごとの「領域」に入っています。領域は `s_` で始まる ID で区別します。
API トークンは `OWNER_EMAIL` の人として動き、その人の領域を読み書きします。手元で認証なしのときは、領域は `local` の1つだけです。

```sh
node cli.ts spaces # 開ける領域。* が自分の領域、ほかは共有されたもの（閲覧のみ）
node cli.ts show --space s_xxxxxxxxxxxx # 共有された領域を読む（maps・show・export だけ）
node cli.ts share # 自分の領域を共有している相手
node cli.ts share add someone@example.com # 読み取り専用で共有する（ALLOWED_EMAILS にある人だけ）
node cli.ts share remove someone@example.com
```

共有された領域には書き込めません。共有の追加と解除は、頼まれたときだけ行ってください。

## マップは複数ある

マップは名前で区別します。画面と CLI は「今選んでいるマップ」を対象にします。
画面のツールバー左端のセレクトと CLI の `use` は同じ選択を動かすので、人が画面で切り替えればエージェントの対象も変わり、逆も同じです。

```sh
node cli.ts maps                       # 一覧。* が今選んでいるマップ
node cli.ts use 採用計画               # 切り替える（画面も切り替わる）
node cli.ts new "採用計画" --map 採用計画   # 新しいマップを作る。選択は変わらない
node cli.ts show --map 採用計画        # どのコマンドも --map で対象だけ変えられる
```

人が見ているマップを勝手に切り替えないでください。別のマップを触るときは `use` ではなく `--map` を付けます。
マップ名にスラッシュと先頭のドットは使えません。64文字までです。

## まず現状を見る

```sh
node cli.ts show
```

```
- 新規事業の検討  (n1 中心 配置:両側)
  - 市場  (n2)
    - 国内  (n3)
  - 予算  (n6 折りたたみ:2)
- 採用  (n10 中心 配置:右)
```

括弧の中が ID です。`中心` は中心ノード、`配置` はそのマップの枝の出る向き（両側・右・左）、`折りたたみ:N` は閉じていて子孫が N 件ある印です。

中心ノードは複数置けます。中心ノードごとに独立したマップになり、キャンバスに並びます。

## ノードの指し方

- ID: `n6`
- 完全一致の名前: `予算`
- 経路: `新規事業の検討/市場/海外/北米`（中心ノードの名前は省ける）

同じ名前が複数あると CLI がエラーで候補を出すので、ID か経路で指定し直してください。

## 操作

```sh
node cli.ts add "外注費" --under 予算                 # 子を足す
node cli.ts add "外注費" --under 予算 --after 広告費   # 兄弟の後ろに入れる
node cli.ts rename 北米 "北米（優先）"
node cli.ts move 人件費 --under 市場/海外               # 子ごと移す
node cli.ts remove 広告費                               # 子ごと消す
node cli.ts layout 新規事業の検討 right                 # マップの配置を右だけにする（both / right / left）
node cli.ts side 予算 left                              # 枝を中心の左へ出す（片側のマップは両側になる）
node cli.ts collapse 市場                               # 枝を閉じる
node cli.ts expand 市場
node cli.ts export                                      # Markdown で書き出す（ID なし）
node cli.ts add "採用" --root                           # 新しい中心ノード（独立したマップ）を足す
node cli.ts move 市場 --root                            # 枝を切り離して独立したマップにする
node cli.ts move 採用 --under 予算                      # 中心ノードを別のマップの枝にする
```

`add` で `--under` を省くと、中心ノードが1つのときはその下に入ります。中心ノードが複数あるときは `--under` か `--root` が必要です。

## まとめて入れる: Markdown の箇条書き

骨組みを一気に作るときは、箇条書きを書いて取り込みます。インデント（スペース2つ以上かタブ）が階層です。`-`、`*`、`+`、`1.` を使えます。
`# 見出し` は中心ノードになり、その下の箇条書きが子になります。見出しを複数書くと、マップが複数できます。

```sh
cat > /tmp/outline.md <<'EOF'
# 新規事業の検討
- 市場
  - 国内
  - 海外
- 予算
  - 広告費
EOF
node cli.ts import /tmp/outline.md --replace      # すべてのマップを作り直す
node cli.ts import /tmp/outline.md                # 見出しがあれば、新しいマップとして足す
node cli.ts import /tmp/outline.md --under リスク  # 既存のノードの下に足す
printf -- '- 法務\n- 技術\n' | node cli.ts import - --under リスク   # 標準入力からも読める
```

`--replace` は人が置いた位置や折りたたみも消します。既存のマップに足すときは `--under` を使ってください。

## 守ること

- 操作の前に `show` で名前と ID を確かめる。推測で名前を書かない。
- 人のマップに足すときは `--replace` を使わない。
- 削除は頼まれたときだけ。`remove` は子孫ごと消える。
- 出力は日本語。ノードの文字は短く、一つの考えを一つのノードにする。
- ブラウザを操作してノードを足さない。CLI のほうが速くて確実。

## 中身（変更するとき）

- `public/index.html`: ページ。1ファイルで依存なし。読み書きは `/api/map`（版番号つき）、変更は `/api/ws`（WebSocket）で受ける。共有された領域は `?space=` を付けて開き、閲覧のみになる。
- `src/worker.ts`: 入口。ページは静的アセット（`public/`）が配る。`/api/` は、名簿 `main` で権限を確かめてから、領域の Durable Object へ渡す。
- `src/auth.ts`: Google ログイン（ブラウザ）と API トークン（CLI）の確認。セッションはアカウント ID を持つ。名簿 `main` の中で動く。
- `src/directory.ts`: 名簿。アカウント（Google の sub に結び付けた `a_…`）、領域（`s_…`、今は1人1つ）、共有（領域 → 閲覧者）。
- `src/store.ts`: Durable Object `MindmapStore`。名簿 `main` と、領域ごとの `space:<領域ID>` の2つの役で使う。領域は全マップと「今選んでいるマップ」を SQLite に持ち、API と WebSocket の配信を受け持つ。手元で認証なしのときは `main` が領域 `local` を兼ねる。
- `lib/map.ts`: ノードの解決、追加・移動・削除、箇条書きの読み書き。Durable Object と CLI が共有する。
- `lib/ops.ts`: CLI の操作（add・move など）を、名前の解決ごとマップに当てる。Durable Object が呼ぶ。
- `cli.ts`: コマンドの入口。`node cli.ts` でそのまま動く（Node 23.6 以上）。
- `cloudflare.config.ts`: Worker・binding・Durable Object・secret の宣言と、デプロイ先のアカウント。`wrangler.config.ts`: 静的アセットの置き場と手元の開発サーバーのポート。
- 保存の形: マップ1つが `{ uid, nodes: [{ id, text, parentId, children, side, dx, dy, colorIndex, collapsed }] }`。版番号はマップごとに書き込むたびに1つ上がる。
  `parentId` が `null` のノードが中心ノードで、その `dx, dy` はキャンバス上の位置、`layout` は配置（`both`・`right`・`left`、省略時は `both`）。ほかのノードは位置を持たず、`dx, dy` は常に 0（配置は自動）。
  中心ノードが1つだった頃の `rootId`・`rootPos` と、自由に置けた頃の `pinned` は、読み込むときに自動で直す。
- 型の確認は `npm run typecheck`。
- Cloudflare の操作（開発サーバー・デプロイ・secret・型の生成）は wrangler ではなく `cf` で行う（Node 26.12 以上が要るので `npm run dev` などの scripts か `mise exec -- npx cf <コマンド>`）。このフォルダには個人アカウントの profile `personal` を結び付けてある。
