# 書き出しと取り込み

ユーザーは、マップを ID と状態つきの木（`show`）か、Markdown の箇条書き（`export`）で読みます。逆に、Markdown の箇条書きを取り込んで、枝やマップをまとめて作ります。文字はサーバーの `/api/outline` が作ります。

## Sub-features

- `outline-show`: ID・中心・配置・折りたたみ・リンクの印つきで木を出す。ノードを1つ指すと、その枝だけを出す。
- `outline-export`: `# 中心ノード` と `- 子` の Markdown を出す（ID なし。リンクは `[文字](URL)`）。
- `outline-import-under`: 既存のノードの下に箇条書きを足す（ファイルか標準入力の `-`）。
- `outline-import-headed`: `# 見出し` のある箇条書きを、新しい中心ノードとして足す。
- `outline-import-replace`: `--replace` で、すべてのマップを作り直す。
- `outline-errors`: 無いノードを指すと、その名前つきで断られる。

## How to get to it (user POV)

- 端末で `mindmap show [ノード]`、`mindmap export [ノード]` を実行する。
- 端末で `mindmap import <ファイル|-> [--under <ノード> | --root] [--replace]` を実行する。
- 画面で ⌘C・⌘X したものは箇条書きになり、ほかのアプリの箇条書きを ⌘V で貼るとノードになる（クリップボードの道）。

## Driving it with verify

Preconditions:

- `$V doctor` に `NG` が無い。
- マップ `verify` が無い。

- **元を作る。** `$V cli new "検証" --map verify` と `$V cli add "リスク" --map verify` を実行する。
- **標準入力から取り込む。** `printf -- '- 法務\n- 技術\n  - API\n' | $V cli import - --under リスク --map verify` を実行する。`取り込み: 3 件 → リスク の下` と出る。
- **見出しつきで取り込む。** `printf -- '# 採用\n- 面接\n' > "$($V evidence)/import.md"` で入力を証拠の置き場に作り、`$V cli import "$($V evidence)/import.md" --map verify` を実行する。新しい中心ノード「採用」ができる。
- **show。** `$V cli show --map verify` を実行する。`- 検証  (n1 中心 配置:両側)` の下に `- リスク`、その下に `- 法務`・`- 技術`・`- API` が字下げで並ぶ。`- 採用  (nX 中心 配置:両側)` も出る。
- **枝だけ。** `$V cli show リスク --map verify` を実行する。`- リスク  (n2)` から始まる。
- **export。** `$V cli export --map verify` を実行する。`# 検証`、空行、`# 採用` の2つのブロックが出て、ID は出ない。
- **同じ文字を API でも読む。** `$V api GET '/api/outline?name=verify&ids=1'` の `text` が、`show` の出力と同じになる。
- **エラー。** `$V cli show 無いノード --map verify` を実行する。終了コードは 1 で、`エラー: ノード「無いノード」が見つかりません。show で名前と ID を確認してください` と出る。
- **画面でも確かめる。** `$V cli use verify` のあと `$V dom outline` を撮る。`outline.nodes.txt` に `法務`・`技術`・`API`・`採用`・`面接` がある。
- **片付け。** もとのマップに `use` で戻し、`$V api DELETE /api/maps '{"name":"verify"}'` を実行する。

## Gotchas

- `--replace` は、領域の**すべての**マップを作り直す。検証用の使い捨てのサーバー以外では使わない。
- 箇条書きの字下げは、スペース2つ以上かタブ。スペース1つは同じ階層とみなされる。
- URL だけの行はリンクになり、題名を本当にその URL へ取りに行く（外への通信）。外へ出したくないときは `- [文字](URL)` と書く。
- `export` の中心ノードは `# 見出し` になる。`show` の中心ノードは `- 文字  (nX 中心 …)` の行になる。両方を比べるときは、形の違いを前提にする。
- 古い Worker には `/api/outline` が無く、CLI は「サーバー（…）に /api/outline がありません」と断る。`$V doctor` で前もって分かる。
