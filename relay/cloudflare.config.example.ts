import { bindings, defineConfig, exports } from "cf/config";
// 复制成 cloudflare.config.ts(不进仓库)再改。

// 自己部署:把 accountId 换成你的,domains 换成你的域名(或删掉用 workers.dev),
// 然后 npm run vapid 生成推送密钥,用 cf workers secrets update 设成 VAPID_PUBLIC / VAPID_PRIVATE_JWK,再 npm run deploy。
export default defineConfig({
	accountId: "<你的 Cloudflare 账号 ID>",
	worker: {
		name: "iimos-relay",
		compatibilityDate: "2026-07-30",
		entrypoint: "src/index.js",
		observability: { enabled: true },
		assets: {
			notFoundHandling: "none",
			runWorkerFirst: ["/", "/m/*", "/vapid"],
		},
		domains: ["relay.iimos.ai"],
		exports: {
			Room: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			ROOMS: bindings.durableObject({ worker: "iimos-relay", exportName: "Room" }),
			ASSETS: bindings.assets(),
		},
	},
});
