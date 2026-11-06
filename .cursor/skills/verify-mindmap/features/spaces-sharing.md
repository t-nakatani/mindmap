# 領域と共有

ユーザーのマップは、Google アカウントごとの「領域」に入っています。自分の領域を、ほかのアカウントに読み取り専用で共有でき、共有された人は `--space` や画面の領域のセレクトで閲覧します。手元の検証用サーバーは認証なしなので、領域は `local` の1つだけです。共有の振る舞いは、断られることまでしか確かめられません。

## Sub-features

- `spaces-list`: 開ける領域の一覧（`*` が自分の領域）。
- `spaces-readonly-guard`: `--space` を付けた書き込みは、CLI が手元で断る（閲覧のみ）。
- `share-local-refused`: 手元モードでは、共有の一覧・追加・解除が断られる。
- `share-real`: 本当の共有と閲覧（Google ログインが要る。手元の検証では届かない）。

## How to get to it (user POV)

- 端末で `mindmap spaces`、`mindmap share [list|add <メール>|remove <メール>]` を実行する。
- 端末で `mindmap show --space <領域ID>` を実行する（`maps`・`show`・`export` だけ）。
- 画面右上の「共有」（`#btn-share`）を押してパネル（`#share-panel`）を開く。または、左上の領域のセレクト（`#space-select`）を使う。

## Driving it with verify

Preconditions:

- `$V doctor` に `NG` が無い。`手元モード（領域 local）` の行がある。

- **領域の一覧。** `$V cli spaces` を実行する。終了コードは 0 で、`* local	local	自分` の1行だけが出る。
- **閲覧のみの守り。** `$V cli add x --space s_abc` を実行する。終了コードは 1 で、`エラー: --space で開ける共有の領域は閲覧のみです。maps・show・export だけ使えます` と出る。サーバーには何も送られない（`api.log` に何も増えない）。
- **共有は手元で断られる。** `$V cli share` を実行する。終了コードは 1 で、`エラー: 手元の認証なしでは共有できません。Google ログインを設定してください` と出る。
- **画面。** ブラウザで開き、`#space-select` と `#btn-share` が見えないか、使えないことを確かめる。手元モードの見た目として、スクリーンショットを撮る。
- **報告。** `share-real` は「Google ログインが要るので、手元の検証では届かない」と書いて報告する。手元の断られ方を、共有の振る舞いの確認として報告しない。

## Gotchas

- 本当の共有を確かめるには、`.dev.vars` に Google の OAuth クライアントの値を入れて、手元でログインする必要がある。このスキルの使い捨てのサーバーでは、`.dev.vars` を読むかどうかは確かめていない。試すなら、ユーザーに確かめてから行う。
- 本番（https://mindmap.tomoya-12.workers.dev）で `share add` を試さない。本当に相手に共有される。
- `--space` の守りは CLI 側の確かめ。API を直接呼んだときの守りは、サーバーの 403（「この領域は閲覧のみです」）で、手元モードでは試せない。
