# リンク

ユーザーは、ノードに URL を1つ付けます。画面では、リンクのノードはサイトのアイコン・題名・↗ の1行で出ます。選ぶと、横にドメイン・説明・画像のパネルが出ます。URL だけを足すと、サーバーがページを読みに行き、題名を文字にします。

## Sub-features

- `link-add-text`: 文字を決めて、リンクのノードを足す（`--url`）。
- `link-add-url`: URL だけを足し、題名を読み込んで文字にする。
- `link-set`: 今あるノードに付ける・付け替える（文字はそのまま）。
- `link-unset`: リンクを外す。
- `link-panel`: 画面でリンクのノードを選ぶと、パネルが出る。↗ で新しいタブに開く。

## How to get to it (user POV)

- 端末で次のどれかを実行する。
  - `mindmap add "<文字>" --url <URL> --under <ノード>`
  - `mindmap add <URL> --under <ノード>`
  - `mindmap link <ノード> <URL>`
  - `mindmap unlink <ノード>`
- 画面でノードを選び、⌘K か下のツールバーの「リンク」（`#btn-link`）を押す。または、URL を ⌘V で貼る。
- Markdown の取り込みで、`- [文字](URL)` か URL だけの行を書く。

## Driving it with verify

Preconditions:

- `$V doctor` に `NG` が無い。
- マップ `verify` が無い。外への通信を避けるなら、題名の読み込み（`link-add-url`）は飛ばす。

- **文字を決めて足す。** `$V cli new "検証" --map verify` と `$V cli add "設計メモ" --url https://example.com/memo --under 検証 --map verify` を実行する。`追加: 設計メモ (n2) ← 検証（リンク: https://example.com/memo）` と出る。
- **show に出る。** `$V cli show --map verify` を実行する。`- 設計メモ  (n2 リンク:https://example.com/memo)` と出る。
- **export では Markdown のリンク。** `$V cli export --map verify` を実行する。`- [設計メモ](https://example.com/memo)` と出る。
- **付け替え。** `$V cli add "予算" --under 検証 --map verify` と `$V cli link 予算 https://example.com/budget --map verify` を実行する。`show` で `予算` に `リンク:https://example.com/budget` が付き、文字は `予算` のまま。
- **外す。** `$V cli unlink 設計メモ --map verify` を実行する。`リンクを外す: 設計メモ (n2)、https://example.com/memo` と出て、`show` からその `リンク:` が消える。
- **画面のパネル。** 次の順に確かめる。
  1. `$V cli use verify` を実行し、ブラウザで開いて `#btn-fit` を押す。
  2. `予算` のノード（`g.node` の中の「予算」）をクリックする。
  3. `#link-panel` が見えるようになり、`#lp-url` に `example.com/budget` が出る。
  4. 内蔵ブラウザのスクリーンショットを撮る。
- **題名の読み込み（任意。外へ出る通信あり）。** `$V cli add https://example.com/ --under 検証 --map verify` を実行する。文字が `Example Domain` になる。外へ出られない環境では、URL がそのまま文字になるか、エラーになる。どちらだったかを書いて報告する。
- **片付け。** もとのマップに `use` で戻し、`$V api DELETE /api/maps '{"name":"verify"}'` を実行する。

## Gotchas

- 使える URL は `http://` か `https://` で始まるものだけ。それ以外は断られる。
- 人が付けた文字は、題名で上書きされない。`link` で付け替えても、文字はそのまま。
- 題名・説明・画像は保存されず、`/api/unfurl` が領域ごとに覚えておく（読めたものは1週間、読めなかったものは1時間）。同じ URL を2回目に試しても、外へは出ない。
- 手元やネットワーク内のアドレス（127.0.0.1 など）の題名を読み込めるのは、手元モード（領域 `local`）のときだけ。本番では断られる。
- 画面でリンクのノードの ↗ を押すと、新しいタブが開く。ブラウザを動かす道具で、タブが増えたことを前提にする。
