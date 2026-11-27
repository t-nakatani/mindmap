// 日次 ToDo の Worker（cf CLI が読む）。<mind-map> 部品の最初の利用者で、マインドマップ本体とは別の Worker・別のデータ。
// ログインは Google（本体と同じ OpenID Connect。src/auth.ts）。ログインできるのは ALLOWED_EMAILS の人だけ。
import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
	// 個人のアカウント。本体（../../cloudflare.config.ts）と同じ。
	accountId: "fc67326028bcf5bc787347b6a7173394",
	worker: {
		name: "daily-todo",
		compatibilityDate: "2026-10-01",
		entrypoint: "src/worker.ts",
		observability: {
			enabled: true,
		},
		// ページと部品（mindmap-element）は静的アセット。/api/ と日付のページ（/2026-11-27）は Worker が受ける。
		assets: {
			runWorkerFirst: [
				"/api/*",
				"/20*",
			],
		},
		// 人ごとの ToDo とマップ（user:<メールアドレス>）と、ログインのセッション（auth）。
		exports: {
			DailyStore: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			STORE: bindings.durableObject({
				worker: "daily-todo",
				exportName: "DailyStore",
			}),
			ASSETS: bindings.assets(),
			// Google の OAuth クライアント（本体と同じものを使える。リダイレクト URI に /api/auth/google/callback を足す）。
			// 手元の 127.0.0.1 で GOOGLE_CLIENT_ID が無ければ、認証なしで動く。
			GOOGLE_CLIENT_ID: bindings.secret(),
			GOOGLE_CLIENT_SECRET: bindings.secret(),
			// ログインできるメールアドレス（カンマ区切り）。空ならだれもログインできない。
			ALLOWED_EMAILS: bindings.secret(),
		},
	},
});
