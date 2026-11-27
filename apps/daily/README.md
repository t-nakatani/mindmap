# 日次 ToDo（apps/daily）

1日1ページ（`/2026-11-27`）。先頭に `<mind-map>`（`packages/mindmap-element`）、下に ToDo。マインドマップ本体の API やログインには頼らず、自分の Worker と Durable Object に保存する。部品を使う側の最初の例。

- `src/worker.ts`: 入口。日付のパスはページを返す。`/api/*` は Google ログインのセッションで人を確かめ、人ごとの Durable Object（`user:<email>`）へ渡す。書き込みは同一オリジンだけ。
- `src/auth.ts`: Google ログイン（本体の `src/auth.ts` と同じ OpenID Connect、PKCE・state・nonce）。セッションは Durable Object `auth` に置く。secret `GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`（本体と同じ OAuth クライアントでよい。リダイレクト URI に `https://<host>/api/auth/google/callback` を足す）と `ALLOWED_EMAILS`（ログインできるメールアドレス、カンマ区切り）が要る。手元（127.0.0.1）で `GOOGLE_CLIENT_ID` が無ければ `local` の1人として動く。
- `src/store.ts`: `DailyStore`。マップは `MindmapMaps`（`/api/mindmap/*`、マップ名 `daily-YYYY-MM-DD`）、ToDo は自前の表（`/api/todos`）。今日を開くと、前の日の未完了を持ち越す。
- `public/index.html`・`page/main.js`: ページ。`main.js` は部品をパッケージ `@t-nakatani/mindmap-element` として読み、`npm run page`（esbuild）で `public/assets/main.js` にまとめる（まとめたものはコミットしない）。dev・build・deploy は先にこれを行う。

```sh
npm install       # リポジトリのルートで（workspaces）
npm run dev       # http://127.0.0.1:4382
npm run deploy    # 個人アカウント（profile personal）の Worker daily-todo へ
```
