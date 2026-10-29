// Worker の設定（cf CLI が読む）。ビルドの設定（静的アセットの置き場など）は wrangler.config.ts にある。
import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
	// 個人のアカウント。cf が別のアカウント（会社など）でログインしていても、ここ以外には出さない。
	accountId: "fc67326028bcf5bc787347b6a7173394",
	worker: {
		name: "mindmap",
		compatibilityDate: "2026-10-01",
		entrypoint: "src/worker.ts",
		observability: {
			enabled: true,
		},
		// ページ（index.html と favicon.svg）は静的アセットとして配る。/api/ は Worker が受ける。
		assets: {
			runWorkerFirst: [
				"/api/*",
			],
		},
		// 全マップと「今選んでいるマップ」を持つ Durable Object。wrangler の migrations（v1 の new_sqlite_classes）で
		// 作ったものなので、同じ SQLite のまま宣言する。
		exports: {
			MindmapStore: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			STORE: bindings.durableObject({
				worker: "mindmap",
				exportName: "MindmapStore",
			}),
			ASSETS: bindings.assets(),
			// Google ログインと CLI のトークン（src/auth.ts）。値は Worker の secret にある。手元では .dev.vars に書く。
			// OWNER_EMAIL は API_TOKEN が動く人で、領域を分ける前のマップの移し先。
			GOOGLE_CLIENT_ID: bindings.secret(),
			GOOGLE_CLIENT_SECRET: bindings.secret(),
			ALLOWED_EMAILS: bindings.secret(),
			API_TOKEN: bindings.secret(),
			OWNER_EMAIL: bindings.secret(),
		},
	},
});
