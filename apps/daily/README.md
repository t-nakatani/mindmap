# 日次 ToDo（apps/daily）

1日1ページ（`/2026-11-27`）。先頭に `<mind-map>`（`packages/mindmap-element`）、下に ToDo。マインドマップ本体の API やログインには頼らず、自分の Worker と Durable Object に保存する。部品を使う側の最初の例。

- `src/worker.ts`: 入口。日付のパスはページを返す。`/api/*` は Cloudflare Access で人を確かめ、人ごとの Durable Object（`user:<email>`）へ渡す。書き込みは同一オリジンだけ。
- `src/access.ts`: Access の JWT（`Cf-Access-Jwt-Assertion`）の確認。secret `ACCESS_TEAM_DOMAIN`（例 `https://xxx.cloudflareaccess.com`）と `ACCESS_AUD` が要る。手元（127.0.0.1）で未設定なら `local` の1人として動く。
- `src/store.ts`: `DailyStore`。マップは `MindmapMaps`（`/api/mindmap/*`、マップ名 `daily-YYYY-MM-DD`）、ToDo は自前の表（`/api/todos`）。今日を開くと、前の日の未完了を持ち越す。
- `public/index.html`: ページ。`npm run element` で部品を `public/mindmap-element/` に写してから配る（写したものはコミットしない）。

```sh
npm run dev       # http://127.0.0.1:4382
npm run deploy    # 個人アカウント（profile personal）の Worker daily-todo へ
```
