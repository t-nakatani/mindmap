# ノードの操作

ユーザーは、ノードを足し、名前を変え、別の親の下へ移し、子孫ごと消し、枝を折りたたみ、マップの配置（両側・右・左）や枝の左右を変えます。CLI で変えた内容は、開いている画面に、読み込み直さなくてもすぐ出ます。

## Sub-features

- `node-add`: 子を足す。`--after` で兄弟の後ろに入れ、`--root` で新しい中心ノードを足す。
- `node-rename`: 名前を変える。
- `node-move`: 子ごと別の親の下へ移す。`--root` で切り離して独立したマップにする。
- `node-remove`: 子孫ごと消す。
- `node-collapse`: 枝を折りたたむ・開く。
- `node-layout`: マップの配置（both・right・left）と、枝の左右（side）を変える。
- `node-live`: CLI の変更が、開いている画面にすぐ出る。
- `node-keys`: 画面で Tab（子）・Enter（兄弟）・文字の入力・Delete・⌘Z を使う。

## How to get to it (user POV)

- 端末で `mindmap add|rename|move|remove|collapse|expand|layout|side …` を実行する。
- 画面でノードを選び、Tab・Enter・文字キー・Delete・⌘. を押す。または、ノードの外側の丸を押して折りたたむ。
- 画面の下のツールバーの「配置」（両側・右・左）と「枝」（◀左・右▶）を使う。

## Driving it with verify

Preconditions:

- `$V doctor` に `NG` が無い。
- マップ `verify` が無い（`$V api GET /api/maps` で確かめる）。

- **マップを作る。** `$V cli new "検証" --map verify` を実行する。終了コードは 0 で、`マップ「verify」を作りました: 検証 (n1)` と出る。
- **子と兄弟を足す。** `$V cli add "市場" --map verify`、`$V cli add "海外" --under 市場 --map verify`、`$V cli add "国内" --under 市場 --after 海外 --map verify` を実行する。それぞれ `追加: 海外 (n3) ← 検証/市場` のように、ID と親の経路が出る。
- **経路で指す。** `$V cli add "北米" --under 市場/海外 --map verify` を実行する。`← 検証/市場/海外` と出る。
- **改名・移動・折りたたみ・配置。** 次を順に実行する。
  - `$V cli rename 北米 "北米（優先）" --map verify`
  - `$V cli move 国内 --under 市場/海外 --map verify`
  - `$V cli collapse 市場 --map verify`
  - `$V cli layout 検証 right --map verify`

  それぞれ `改名:`・`移動:`・`折りたたみ: 市場 (n2)、子孫 N 件`・`配置: 検証 (n1) を右に` と出る。
- **状態を読み直す。** `$V cli show --map verify` を実行する。`- 検証  (n1 中心 配置:右)` と `- 市場  (n2 折りたたみ:N)` が出る。`$V api GET '/api/map?name=verify'` の `version` は、書き込みの回数だけ上がっている。
- **即時反映（画面）。** 次の順に確かめる。
  1. `$V cli use verify` で画面の対象をこのマップにする。
  2. ブラウザで `http://127.0.0.1:4388/` を開き、`#btn-fit` を押す。
  3. ページを開いたまま `$V cli add "反映テスト" --under 検証 --map verify` を実行する。
  4. 読み込み直さずに、`g.node` の中に「反映テスト」が出ることを確かめる（`find "反映テスト"` か、`javascript_tool` で `document.querySelector('#nodes').textContent.includes('反映テスト')`）。
  5. 内蔵ブラウザのスクリーンショットを撮る。
- **画面のキー操作。** 次の順に確かめる。
  1. 画面で「反映テスト」のノードをクリックして選ぶ。
  2. Tab を押し、`キー追加` と打って Enter を押す。
  3. `$V cli show --map verify` で、「反映テスト」の下に「キー追加」があることを確かめる。画面の操作がサーバーに保存されたことの証明になる。
- **消す。** `$V cli remove 反映テスト --map verify` を実行する。`削除: 反映テスト (nX) と子孫、合わせて 2 件` と出る。
- **証拠。** `$V shot node-ops` と `$V dom node-ops` を撮る。`node-ops.nodes.txt` の1行目が `title: verify - Mind Map` で、`n1	検証	[root …]` と `n2	市場	[collapsed]` の行がある。`北米（優先）` は閉じた `市場` の中なので出ない（出ていたら折りたたみが効いていない）。PNG では、`市場` の右に子孫の数の丸（3）が付く。
- **片付け。** `$V cli use map`（もとのマップがあれば）と `$V api DELETE /api/maps '{"name":"verify"}'` を実行する。最後の1つのマップは消せないので、`map` が残っていることを確かめる。

## Gotchas

- 中心ノードが2つ以上あると、`--under` を省いた `add` は断られる。`--under` か `--root` を付ける。
- 同じ名前のノードが2つあると、名前での指定は断られ、候補の ID と経路が出る。手順では経路か ID を使う。
- 折りたたんだ枝の子も `g.node` として DOM にあるが、`hidden` のクラスが付いて見えない。`dom` の一覧には出ない。消えたかどうかは `show` で確かめる。
- 画面で文字キーを押すと、選択中のノードの文字が書き換わる。操作の前に、どのノードが選ばれているかを確かめる。
- `layout` は中心ノードにだけ効く。`side` は、片側だけのマップを両側に変える。
- `verify dom` と `verify shot` はページを開き直すので、即時反映の証拠にならない。
