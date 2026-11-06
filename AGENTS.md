# エージェント向け: このマインドマップの動かし方

このリポジトリは、ブラウザで動くマインドマップと、それを操作する CLI です。裏側は Cloudflare の Worker と Durable Object です。
エージェントは **CLI だけ** でマップを読み書きします。CLI は API を呼び、書き込みはサーバー側で順に行われます。
CLI の変更はブラウザに即時に（WebSocket で）反映されます。人がブラウザで動かした内容も同じところに入ります。

## CLI を入れる

CLI は `mindmap` という1つの実行ファイルです（Rust、`cli/`）。GitHub Releases から入れます。

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/t-nakatani/mindmap/releases/latest/download/mindmap-installer.sh | sh
```

Windows は `powershell -ExecutionPolicy Bypass -c "irm https://github.com/t-nakatani/mindmap/releases/latest/download/mindmap-installer.ps1 | iex"`。
このリポジトリからビルドするときは `cargo install --path cli`（`npm run cli -- show` でも動く）。

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
mindmap spaces # 開ける領域。* が自分の領域、ほかは共有されたもの（閲覧のみ）
mindmap show --space s_xxxxxxxxxxxx # 共有された領域を読む（maps・show・export だけ）
mindmap share # 自分の領域を共有している相手
mindmap share add someone@example.com # 読み取り専用で共有する（メールアドレスなら誰でも。初回ログインで結び付く）
mindmap share remove someone@example.com
```

共有された領域には書き込めません。共有の追加と解除は、頼まれたときだけ行ってください。

## マップは複数ある

マップは名前で区別します。画面と CLI は「今選んでいるマップ」を対象にします。
画面の左上のマップ名（マップの一覧）と CLI の `use` は同じ選択を動かすので、人が画面で切り替えればエージェントの対象も変わり、逆も同じです。

```sh
mindmap maps                       # 一覧。* が今選んでいるマップ
mindmap use 採用計画               # 切り替える（画面も切り替わる）
mindmap new "採用計画" --map 採用計画   # 新しいマップを作る。選択は変わらない
mindmap show --map 採用計画        # どのコマンドも --map で対象だけ変えられる
```

人が見ているマップを勝手に切り替えないでください。別のマップを触るときは `use` ではなく `--map` を付けます。
マップ名にスラッシュと先頭のドットは使えません。64文字までです。
マップの名前の変更と削除は、人が画面のマップの一覧で行います（API は `PATCH /api/maps`・`DELETE /api/maps`）。頼まれていないのにマップを消さないでください。

## まず現状を見る

```sh
mindmap show
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
mindmap add "外注費" --under 予算                 # 子を足す
mindmap add "外注費" --under 予算 --after 広告費   # 兄弟の後ろに入れる
mindmap rename 北米 "北米（優先）"
mindmap move 人件費 --under 市場/海外               # 子ごと移す
mindmap remove 広告費                               # 子ごと消す
mindmap layout 新規事業の検討 right                 # マップの配置を右だけにする（both / right / left）
mindmap side 予算 left                              # 枝を中心の左へ出す（片側のマップは両側になる）
mindmap collapse 市場                               # 枝を閉じる
mindmap expand 市場
mindmap export                                      # Markdown で書き出す（ID なし）
mindmap add "採用" --root                           # 新しい中心ノード（独立したマップ）を足す
mindmap move 市場 --root                            # 枝を切り離して独立したマップにする
mindmap move 採用 --under 予算                      # 中心ノードを別のマップの枝にする
```

`add` で `--under` を省くと、中心ノードが1つのときはその下に入ります。中心ノードが複数あるときは `--under` か `--root` が必要です。

## リンク

ノードには URL を1つ付けられます。画面では、サイトのアイコン・ページの題名・↗ の1行で表示され、↗ で開けます。

```sh
mindmap add https://developers.cloudflare.com/durable-objects/ --under 参考資料   # 題名を読み込んで文字にする
mindmap add "設計メモ" --url https://example.com/memo --under 参考資料            # 文字を決めて付ける
mindmap link 予算 https://example.com/budget                                     # 今あるノードに付ける（文字はそのまま）
mindmap unlink 予算
```

`show` では `(n5 リンク:https://…)` と出ます。`export` と `import` では `- [文字](URL)` と書き、URL だけの行もリンクになります（題名を読み込みます）。
URL は `http://` か `https://` で始まるものだけです。人が付けた文字は、題名で上書きしません。

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
mindmap import /tmp/outline.md --replace      # すべてのマップを作り直す
mindmap import /tmp/outline.md                # 見出しがあれば、新しいマップとして足す
mindmap import /tmp/outline.md --under リスク  # 既存のノードの下に足す
printf -- '- 法務\n- 技術\n' | mindmap import - --under リスク   # 標準入力からも読める
```

`--replace` は人が置いた位置や折りたたみも消します。既存のマップに足すときは `--under` を使ってください。

## 守ること

- 操作の前に `show` で名前と ID を確かめる。推測で名前を書かない。
- 人のマップに足すときは `--replace` を使わない。
- 削除は頼まれたときだけ。`remove` は子孫ごと消える。
- 出力は日本語。ノードの文字は短く、一つの考えを一つのノードにする。
- ブラウザを操作してノードを足さない。CLI のほうが速くて確実。

## ブランチ

- ブランチ名は `feat/<slug>` にそろえる。slug は変更の中身を表す英小文字とハイフン（例: `feat/cut-copy-paste`）。

## 中身（変更するとき）

- 画面のデザインは Figma の [Mind Map — UI](https://www.figma.com/design/qOSm5azBhDhv6g30qS23aS) が正。色・余白・角丸は Figma の変数と同じ名前の CSS 変数（`:root` の `--color-*`・`--space-*`・`--radius-*`）だけを使い、値を直接書かない。画面を変えるときは Figma の Screens と Components を先に直す（Figma の MCP で読み書きできる）。
- `public/index.html`: ページ。1ファイルで依存なし。読み書きは `/api/map`（版番号つき）、変更は `/api/ws`（WebSocket）で受ける。共有された領域は `?space=` を付けて開き、閲覧のみになる。
- `src/worker.ts`: 入口。ページは静的アセット（`public/`）が配る。`/api/` は、名簿 `main` で権限を確かめてから、領域の Durable Object へ渡す。
- `src/auth.ts`: Google ログイン（ブラウザ）と API トークン（CLI）の確認。セッションはアカウント ID を持つ。名簿 `main` の中で動く。
- `src/directory.ts`: 名簿。アカウント（Google の sub に結び付けた `a_…`）、領域（`s_…`、今は1人1つ）、共有（領域 → 閲覧者）。
- `src/store.ts`: Durable Object `MindmapStore`。名簿 `main` と、領域ごとの `space:<領域ID>` の2つの役で使う。領域は全マップと「今選んでいるマップ」を SQLite に持ち、API と WebSocket の配信を受け持つ。手元で認証なしのときは `main` が領域 `local` を兼ねる。
- `lib/map.ts`: ノードの解決、追加・移動・削除、箇条書きの読み書き。Durable Object が使う。
- `lib/ops.ts`: CLI の操作（add・move など）を、名前の解決ごとマップに当てる。Durable Object が呼ぶ。
- `cli/`: Rust の CLI（`mindmap`）。API を呼ぶだけの薄いクライアントで、マップの形やノードの解決を持たない。`show`・`export` の文字も `GET /api/outline` でサーバーが作る。マップの形や操作を変えるときは、`lib/` と `src/store.ts` を直せば CLI はそのまま使える。新しいコマンドや引数を足すときだけ `cli/src/main.rs` を直す。
  `cargo build --release` で `target/release/mindmap` ができる。確かめるときは `MINDMAP_URL=http://127.0.0.1:4381` を付け、`~/.config/mindmap/env` のデプロイ先を使わない。
- 配布は cargo-dist（`dist-workspace.toml`、`.github/workflows/release.yml`）。`cli/Cargo.toml` の `version` を上げてコミットし、`v0.2.0` のようなタグを push すると、macOS・Linux・Windows のバイナリとインストーラーが GitHub Releases に出る。設定を変えたら `dist generate` でワークフローを作り直す。
- `cloudflare.config.ts`: Worker・binding・Durable Object・secret の宣言と、デプロイ先のアカウント。`wrangler.config.ts`: 静的アセットの置き場と手元の開発サーバーのポート。
- `src/unfurl.ts`: リンクの展開。ページの `<head>` を読んで、題名・サイト名・説明・画像・アイコンを返す（`GET /api/unfurl?url=`）。手元やネットワーク内のアドレスは、手元の開発（領域 `local`）でだけ読む。
- 保存の形: マップ1つが `{ uid, nodes: [{ id, text, parentId, children, side, dx, dy, colorIndex, collapsed, url? }], boards: [{ id, name, x, y, w, h }] }`。版番号はマップごとに書き込むたびに1つ上がる。
  `boards` は画面で作るボード（四角い区画、`x, y` は左上）。中のマップは持たず、画面で動かすときに中心ノードの位置で決める。CLI の操作は `boards` に触れずにそのまま残す。
  リンクのあるノードは `url`（http か https）を持つ。リンク先の題名・説明・画像・アイコンは保存せず、`/api/unfurl` が領域ごとに1週間覚えておく。
  `parentId` が `null` のノードが中心ノードで、その `dx, dy` はキャンバス上の位置、`layout` は配置（`both`・`right`・`left`、省略時は `both`）。ほかのノードは位置を持たず、`dx, dy` は常に 0（配置は自動）。
  中心ノードが1つだった頃の `rootId`・`rootPos` と、自由に置けた頃の `pinned` は、読み込むときに自動で直す。
- 型の確認は `npm run typecheck`。
- Cloudflare の操作（開発サーバー・デプロイ・secret・型の生成）は wrangler ではなく `cf` で行う（Node 26.12 以上が要るので `npm run dev` などの scripts か `mise exec -- npx cf <コマンド>`）。このフォルダには個人アカウントの profile `personal` を結び付けてある。
