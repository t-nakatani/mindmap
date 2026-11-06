---
name: verify-mindmap
description: mindmap（ブラウザのマインドマップ public/index.html と、Rust の CLI `mindmap`、裏側は Cloudflare Worker と Durable Object）を、手元で本物どおりに動かして振る舞いを証明する。ふだんの開発サーバー（4381）とは別のポートと使い捨てのデータで Worker を立て、CLI・API・headless Chrome・ブラウザ操作で機能を動かし、出力とスクリーンショットを証拠として残す。CLI のコマンド、/api/ の振る舞い、画面への即時反映（WebSocket）、マップの一覧・リンク・取り込みなどの変更を「動くことを確かめて」と言われたとき、PR の前に動作の証拠が要るときに使う。
---

# mindmap を動かして確かめる

対象は3つの面です。

- **画面**（主）: `public/index.html`。ノードの木を SVG で描き、変更を WebSocket で受ける。
- **CLI**: Rust の `mindmap`（`cli/`）。API を呼ぶだけの薄いクライアント。エージェントが使う面。
- **API**: Worker の `/api/`。CLI と画面の両方がこれを使う。

検証は、専用のハーネス `scripts/verify` で行います。ふだんの開発サーバー（ポート 4381、データは `.wrangler/state/`）にはユーザーのマップが入っているので、**検証では使いません**。検証用のサーバーはポート 4388 で立て、データは毎回空から始めます（4388 は portmap に `mindmap-verify` として登録してある）。

以下のコマンドは、リポジトリの根（`~/dev/apps/mindmap`）で実行します。

```sh
V=.cursor/skills/verify-mindmap/scripts/verify
```

## Launch

1. CLI をビルドする（Rust が要る。初回は1分ほど）。

   ```sh
   $V build          # → mindmap 0.1.0
   ```

2. 検証用のサーバーを立てる。どちらか一方だけを使う。
   - 既定: `$V launch`。裏で立て、`ready: http://127.0.0.1:4388（run <ID>、ログ …）` と出るまで待つ（最大120秒。ふだんは10秒ほど）。画面を操作するときは、内蔵ブラウザで `preview_start {url: "http://127.0.0.1:4388"}` を開く（これはタブを開くだけで、サーバーは立てない。閉じるのは `tabs_close`）。
   - サーバーごと `preview_start` に任せるとき: `preview_start {name: "mindmap-verify"}`。`mindmap-verify` は `verify serve` を前面で動かし、ブラウザのタブも開く。設定はリポジトリの `.claude/launch.json` にある。ただし、セッションを `~/dev` で開いたときは `~/dev/.claude/launch.json` が読まれるので、そちらにも同じ項目（`runtimeExecutable` は絶対パス）が要る。「No server named "mindmap-verify"」と出たら、読まれている方の launch.json に足す。
   どちらも、立てるたびに使い捨てのフォルダ（`$TMPDIR/verify-mindmap-4388/work`）を作り直し、そこから `cf dev` を動かします。サーバーは認証なしの手元モードで動き、領域は `local` の1つだけです。

   **なぜフォルダを分けるか。** `cf dev` は、データの置き場を変えられません。`--persist-to` は受け付けず、データはいつも設定ファイル（`wrangler.config.ts`）の隣の `.wrangler/state` に入ります。ポートも `cf dev -- --port` では変わらず、`wrangler.config.ts` の `dev.port`（4381）が勝ちます。そこで `serve` は、使い捨てのフォルダに設定ファイルの写し（ポートを書き換えたもの）と、ソース・`node_modules` へのリンクを並べて立てます。リポジトリで `cf dev` を直接動かすと、ユーザーのマップ（リポジトリの `.wrangler/state`）に書き込むので、検証では使いません。`.dev.vars` は持ち込まないので、Google ログインは使えません。

3. ほかのポートで並べて動かすときは、すべてのコマンドに `VERIFY_PORT=<番号>` を付ける。ポートを決める前に https://portmap.localhost/api/state で空きを確かめる。

止め方は Cleanup にあります。

## Doctor

おかしいと思ったら、まずこれを実行します。読むだけで、何も変えません。

```sh
$V doctor
```

`NG` が1行でもあれば、そのインスタンスは動かしません。確かめる内容は次のとおりです。

- サーバーが応答する。
- ポートを持つプロセスが、使い捨てのフォルダ（`$TMPDIR/verify-mindmap-4388/work`）から動いている。リポジトリから動いているもの（ふだんの開発サーバー）は触らない。
- マップのデータ（Durable Object の SQLite）が、使い捨てのフォルダの `.wrangler/state` にある。
- 手元モード（`accountId` が `local`）である。
- サーバーが `/api/outline` を持つ（古い Worker ではない）。
- CLI がビルドされている。
- 証拠の置き場。

## Drive

### CLI

CLI は必ず `$V cli` を通します。`$V cli` は次のことをします。

- `HOME` を使い捨ての場所に差し替える。こうしないと CLI が `~/.config/mindmap/env` の**本番のつなぎ先とトークン**を読んでしまう。
- `MINDMAP_URL` を検証用のサーバーに向ける。
- コマンド・標準出力・標準エラー・終了コードを、証拠の `cli.log` に追記する。

```sh
$V cli new "検証" --map verify     # 空のサーバーにマップを作る
$V cli add "市場" --map verify
$V cli show --map verify
printf -- '- 法務\n- 技術\n' | $V cli import - --under 市場 --map verify
```

`target/release/mindmap` を直接呼ばないでください。直接呼ぶと、本番に書き込むおそれがあります。

### API（状態を別の口から確かめる）

```sh
$V api GET '/api/maps'
$V api GET '/api/map?name=verify'          # JSON と版番号（version）
$V api GET '/api/outline?name=verify&ids=1'
$V api DELETE /api/maps '{"name":"verify"}'
```

結果は証拠の `api.log` にも残ります。

### 画面

画面は、`/api/current`（今選んでいるマップ）を開きます。CLI の `use <マップ名>` で切り替えると、開いている画面も切り替わります。

- **ファイルに残す証拠**（どの環境でも使える）
  - `$V shot <名前>`: headless Chrome で `<証拠>/<名前>.png` を撮る。
  - `$V dom <名前>`: 描いた後の DOM を `<証拠>/<名前>.dom.html` に、見えているノードを `<証拠>/<名前>.nodes.txt` に書き出す。1行目はページの題名（`title: <マップ名> - Mind Map`）。2行目からは `<ID>	<文字>	[root collapsed selected]` の形で、閉じた枝の中のノードは出ない。
  - どちらも `scripts/capture.mjs` が、DevTools のプロトコルで headless Chrome を動かして撮る。ノードが描かれるのを待ち、`#btn-fit` を押し、位置が動かなくなってから撮る（6秒ほど）。`chrome --screenshot` や `--dump-dom` は使わない。仮想時間で動くので、ノードが親から伸びるアニメーションが2コマで止まり、ノードが重なった絵になる。
- **操作する**: ブラウザを動かす道具（Claude の内蔵ブラウザなら `find`・`computer`・`javascript_tool`）で `http://127.0.0.1:4388/` を操作する。手がかりには次のものを使う。
  - ノード: `g.node[data-id="n3"]`。ボードは `g.board[data-id]`。
  - 今のマップ名: `#map-btn-name`。マップの一覧を開くのは `#map-btn`。一覧の中は、検索欄 `#map-search` と `#map-list`（`role="listbox"`、`aria-label="マップの一覧"`）。
  - ボタン: 全体を表示 `#btn-fit`、新しいマップ `#btn-add-map`、ボード `#btn-add-board`、リンク `#btn-link`、ヘルプ `#btn-help`。
  - パネル: リンクの横のパネル `#link-panel`（題名は `#lp-title`、URL は `#lp-url`）、文字の編集欄 `#editor`。
  - キー: Tab で子を足す、Enter で兄弟を足す、文字キーで書き換える、Delete で消す、⌘Z で取り消す、⌘0 で全体を表示する。
- ページを開いた直後は、ノードが画面の外にあることがあります。操作する前に `#btn-fit` を押します。開いてすぐに押すと、ノードが描かれる前で、倍率が 10% になることがある。右下の倍率を見て、10% なら、もう一度押す。`verify shot` と `verify dom` は自分で `#btn-fit` を押す。
- 画面のキー操作の直後に撮ったスクリーンショットは、描き直しの途中のことがある（編集欄が空に見えるなど）。結果は `$V cli show` で確かめ、スクリーンショットは撮り直す。

機能ごとの手順は [features/README.md](features/README.md) にあります。

## Evidence

証拠の置き場は `.verify/evidence/<run>/` です（git の対象外）。`<run>` は launch のときの時刻で、`$V evidence` で出せます。Cleanup のあとも残ります。

- `cli.log`: CLI のコマンド・出力・終了コード
- `api.log`: API で読んだ状態
- `<名前>.png`、`<名前>.nodes.txt`、`<名前>.dom.html`: 画面の証拠

証明の基準:

- **ユーザーが通る道で動かす。** CLI のコマンドか画面の操作を使う。`PUT /api/map` で丸ごと書き換えて結果を作らない。
- **操作と結果の両方を残す。** CLI の出力（`追加: 市場 (n2) ← 検証` など）と、そのあとの状態の両方を残す。
- **別の口から読み直す。** CLI で書いたら、`api GET /api/map` か `show`、そして画面（`dom` か `shot`）で確かめる。版番号（`version`）が書き込みのたびに1つ上がることも見る。
- **画面への即時反映は、ページを開いたまま確かめる。** 画面を開いたまま CLI で書き、読み込み直さずにノードが出ることを見る（ブラウザの道具で `g.node` を探す）。`verify dom` と `verify shot` はページを開き直すので、即時反映の証拠にはならない。
- **外へ出る通信に気をつける。** リンクの題名の読み込み（URL だけの `add`、`import` の URL だけの行）は、その URL へ本当に取りに行く。外へ出したくないときは `--url` で文字を決めて足す。

## Cleanup

```sh
$V cleanup                # launch で立てたサーバーをプロセスグループごと止め、使い捨てのデータを消す
```

- `preview_start {name: "mindmap-verify"}` で立てたときは、先に `preview_stop` で止めてから `$V cleanup` を実行する（使い捨てのフォルダを消すため）。`preview_stop` に渡すのは `preview_list` の serverId。`preview_start {url}` で開いたタブは `tabs_close` で閉じる。
- `$TMPDIR/verify-mindmap-4388/server.log` は残る（次の launch で上書きされる）。
- プロセス名で止めない（`pkill workerd` などはしない）。ふだんの開発サーバーまで止めてしまう。止めるのは、自分が立てたものだけ。
- 証拠（`.verify/evidence/<run>/`）は消さない。終わったら、そのパスをユーザーに伝える。
- 失敗した試行のあとも毎回 cleanup する。ポート 4388 が残っていると、次の launch が断られる。

## Helpers

`scripts/verify`（実行できる bash）がハーネスです。引数なしで実行すると、使い方を出します。

| コマンド | すること |
|---|---|
| `$V build` | `cargo build --release` で CLI を作り、版を出す |
| `$V serve` | 使い捨てのフォルダを作り直し、そこから検証用サーバーを前面で動かす（`preview_start` 用） |
| `$V launch` | `serve` を裏で動かし、応答するまで待つ |
| `$V doctor` | このインスタンスを動かしてよいかを確かめる（読むだけ） |
| `$V cli <引数...>` | 検証用サーバーに向けて CLI を動かし、記録する。標準入力も渡せる |
| `$V api <METHOD> <パス> [JSON]` | API を直接呼び、記録する |
| `$V shot <名前>` / `$V dom <名前>` | headless Chrome で、落ち着いた画面を撮る / ノードを書き出す（`scripts/capture.mjs`） |
| `$V evidence` | 証拠の置き場を出す |
| `$V cleanup` | 自分が立てたものを止め、使い捨てのデータを消す |

環境変数は2つです。

- `VERIFY_PORT`: 既定は 4388。
- `VERIFY_RUN`: 証拠の置き場の名前。既定は launch の時刻。

確かめられないもの:

- Google ログイン・領域・共有。手元モードには領域 `local` しかないので、`share` は「手元の認証なしでは共有できません」と断られる。
- 本番（https://mindmap.tomoya-12.workers.dev）。検証で本番に向けることはしない。
