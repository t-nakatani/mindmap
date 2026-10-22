# エージェント向け: このマインドマップの動かし方

このリポジトリは、ブラウザで動くマインドマップと、それを操作する CLI です。
エージェントは **CLI だけ** でマップを読み書きします。`data/map.json` を直接編集しないでください。
サーバーが動いていれば、CLI の変更はブラウザに即時に反映されます。人がブラウザで動かした内容も同じファイルに入ります。

## 起動

```sh
node server.mjs            # http://127.0.0.1:4380 でページとAPIを出す
```

ポートは `PORT`、対象ファイルは `MINDMAP_FILE` で変えられます（既定は `data/map.json`）。

## まず現状を見る

```sh
node cli.mjs show
```

```
- 新規事業の検討  (n1)
  - 市場  (n2)
    - 国内  (n3)
  - 予算  (n6 折りたたみ:2)
```

括弧の中が ID です。`固定` は人がドラッグで置いた位置、`折りたたみ:N` は閉じていて子孫が N 件ある印です。

## ノードの指し方

- ID: `n6`
- 完全一致の名前: `予算`
- 経路: `市場/海外/北米`（中心ノードの名前は省く）

同じ名前が複数あると CLI がエラーで候補を出すので、ID か経路で指定し直してください。

## 操作

```sh
node cli.mjs add "外注費" --under 予算                 # 子を足す
node cli.mjs add "外注費" --under 予算 --after 広告費   # 兄弟の後ろに入れる
node cli.mjs rename 北米 "北米（優先）"
node cli.mjs move 人件費 --under 市場/海外               # 子ごと移す
node cli.mjs remove 広告費                               # 子ごと消す
node cli.mjs collapse 市場                               # 枝を閉じる
node cli.mjs expand 市場
node cli.mjs export                                      # Markdown で書き出す（ID なし）
```

`add` と `move` で `--under` を省くと中心ノードの下になります。

## まとめて入れる: Markdown の箇条書き

骨組みを一気に作るときは、箇条書きを書いて取り込みます。インデント（スペース2つ以上かタブ）が階層です。`-`、`*`、`+`、`1.` を使えます。

```sh
cat > /tmp/outline.md <<'EOF'
# 新規事業の検討
- 市場
  - 国内
  - 海外
- 予算
  - 広告費
EOF
node cli.mjs import /tmp/outline.md --replace      # マップを作り直す。「# 見出し」が中心になる
node cli.mjs import /tmp/outline.md --under リスク  # 既存のノードの下に足す
printf -- '- 法務\n- 技術\n' | node cli.mjs import - --under リスク   # 標準入力からも読める
```

`--replace` は人が置いた位置や折りたたみも消します。既存のマップに足すときは `--under` を使ってください。

## 守ること

- 操作の前に `show` で名前と ID を確かめる。推測で名前を書かない。
- 人のマップに足すときは `--replace` を使わない。
- 削除は頼まれたときだけ。`remove` は子孫ごと消える。
- 出力は日本語。ノードの文字は短く、一つの考えを一つのノードにする。
- ブラウザを操作してノードを足さない。CLI のほうが速くて確実。

## 中身（変更するとき）

- `index.html`: ページ。1ファイルで依存なし。保存先は `/api/map`、変更は `/api/events`（SSE）で受ける。
- `server.mjs`: ページの配信、`GET/PUT /api/map`、SSE。`data/map.json` の変化を見て配る。
- `cli.mjs`: コマンドの入口。
- `lib/map.mjs`: ファイル入出力、ノードの解決、追加・移動・削除、箇条書きの読み書き。サーバーと CLI が共有する。
- `data/map.json`: 正本。`{ rootId, rootPos, uid, nodes: [{ id, text, parentId, children, side, pinned, dx, dy, colorIndex, collapsed }] }`。
