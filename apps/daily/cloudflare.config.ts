// 日次 ToDo の Worker（cf CLI が読む）。<mind-map> 部品の最初の利用者で、マインドマップ本体とは別の Worker・別のデータ。
// ログインは Cloudflare Access に任せ、Worker は Access の JWT を確かめる（src/access.ts）。
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
		// 人ごとの ToDo とマップ。Access のメールアドレスごとに1つ。
		exports: {
			DailyStore: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			STORE: bindings.durableObject({
				worker: "daily-todo",
				exportName: "DailyStore",
			}),
			ASSETS: bindings.assets(),
			// Cloudflare Access のチームのドメイン（https://<team>.cloudflareaccess.com）と、アプリの AUD タグ。
			// 無ければ API は 503 を返す（手元の 127.0.0.1 だけは認証なしで動く）。
			ACCESS_TEAM_DOMAIN: bindings.secret(),
			ACCESS_AUD: bindings.secret(),
		},
	},
});
