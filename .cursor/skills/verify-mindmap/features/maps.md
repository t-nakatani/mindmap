# 複数のマップ

ユーザーは、名前の違う複数のマップを持ち、今のマップを切り替えます。画面の左上のマップの一覧と CLI の `use` は同じ選択を動かすので、どちらで切り替えても、画面と CLI の対象がそろいます。

## Sub-features

- `maps-list`: 一覧を出す（`*` が今のマップ。題名・中心ノードの数・更新時刻）。
- `maps-new`: 新しいマップを作る。同じ名前があると断られ、`--replace` で作り直す。
- `maps-use`: 今のマップを切り替える。開いている画面も切り替わる。
- `maps-menu`: 画面のマップの一覧で、探す・切り替える・作る。
- `maps-rename-delete`: 画面の一覧で、名前を変える（鉛筆）・消す（ゴミ箱）。最後の1つは消せない。

## How to get to it (user POV)

- 端末で `mindmap maps`、`mindmap new <題名> --map <名前>`、`mindmap use <名前>` を実行する。
- 画面の左上のマップ名（`#map-btn`）を押して一覧を開く。または、マップ名の右の ＋（`#btn-add-map`）を押す。
- どのコマンドにも `--map <名前>` を付けると、選択を変えずにそのマップを対象にできる。

## Driving it with verify

Preconditions:

- `$V doctor` に `NG` が無い。
- マップ `verify-a`・`verify-b` が無い。

- **2つ作る。** `$V cli new "A案" --map verify-a` と `$V cli new "B案" --map verify-b` を実行する。どちらも `マップ「…」を作りました` と出て、末尾に `画面に出すには: mindmap use …` が付く。選択は変わらない。
- **重複は断られる。** もう一度 `$V cli new "A案" --map verify-a` を実行する。終了コードは 1 で、`マップ「verify-a」はもうあります` と出る。
- **一覧。** `$V cli maps` を実行する。`verify-a	A案	中心 1 件	<年-月-日 時:分>` の行がある。`*` は、作る前と同じマップに付いたまま。
- **切り替えが画面に届く。** 次の順に確かめる。
  1. ブラウザで `http://127.0.0.1:4388/` を開き、`#map-btn-name` の文字を読む。
  2. ページを開いたまま `$V cli use verify-b` を実行する。`選択: verify-b（画面も切り替わります）` と出る。
  3. 読み込み直さずに、`#map-btn-name` が `verify-b` に変わり、ページの題名が `verify-b - Mind Map` になることを確かめる。
- **画面の一覧で切り替える。** 次の順に確かめる。
  1. `#map-btn` を押す。`#map-menu` が開き、`#map-list`（`aria-label="マップの一覧"`）に行が並ぶ。
  2. `#map-search` に `verify-a` と打ち、Enter を押す。
  3. `$V cli maps` で、`*` が `verify-a` に移ったことを確かめる。画面からの切り替えが CLI にも届いたことの証明になる。
- **証拠。** `$V dom maps` を撮る。1行目が `title: verify-a - Mind Map` になる。`$V shot maps` も撮る。
- **片付け。** 次の順に行う。
  1. `$V cli use map` でもとのマップに戻す。`map` が無ければ、残すマップを1つ決めて `use` する。
  2. `$V api DELETE /api/maps '{"name":"verify-a"}'` と `$V api DELETE /api/maps '{"name":"verify-b"}'` を実行する。
  3. `$V cli maps` に、どちらも無いことを確かめる。

## Gotchas

- `use` はユーザーが見ている画面を切り替える。使い捨てのサーバーでだけ使い、最後にもとに戻す。
- `new` で `--map` を省くと、**今のマップ**を中心ノード1つで作り直す（中身が消える）。必ず `--map` を付ける。
- マップ名にスラッシュと先頭のドットは使えない。64文字まで。末尾の `.json` は取られる。
- 改名と削除は、CLI に無い。画面の一覧（鉛筆・ゴミ箱。削除は行の中で確かめてから）か、API の `PATCH`・`DELETE /api/maps` で行う。
- 空のサーバーでは、最初に画面を開くか、`--map` なしの操作をすると、`map` が自動でできる。マップの数を数えるときは、これを前提にする。
