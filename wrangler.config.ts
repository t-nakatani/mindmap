// ビルドと手元の開発サーバーの設定（cf が下で使う wrangler が読む）。Worker の設定は cloudflare.config.ts にある。
import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
	assetsDirectory: "./public",
	// 型は cf dev・cf build のたびに .cloudflare/types/index.d.ts へ書き出す。
	types: {
		generate: true,
	},
	dev: {
		ip: "127.0.0.1",
		port: 4381,
	},
});
