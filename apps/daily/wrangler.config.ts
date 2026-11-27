// ビルドと手元の開発サーバーの設定。Worker の設定は cloudflare.config.ts にある。
import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
	assetsDirectory: "./public",
	types: {
		generate: true,
	},
	dev: {
		ip: "127.0.0.1",
		port: 4382,
	},
});
