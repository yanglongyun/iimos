import { bindings, defineConfig } from "cf/config";
// 复制成 cloudflare.config.ts(不进仓库)再改。

// 自己部署:accountId、domains、D1 的 id 换成你的(D1 和 R2 先用 cf d1 create / cf r2 buckets create 建好)
export default defineConfig({
	accountId: "<你的 Cloudflare 账号 ID>",
	worker: {
		name: "iimos",
		compatibilityDate: "2026-07-30",
		entrypoint: "src/index.js",
		observability: { enabled: true },
		assets: { notFoundHandling: "none", runWorkerFirst: ["/", "/shapes", "/s/*", "/api/*", "/agent.md", "/llms.txt", "/device", "/auth/*"] },
		domains: ["iimos.ai"],
		env: {
			DB: bindings.d1({ name: "iimos", id: "<cf d1 create 返回的 uuid>" }),
			BUCKET: bindings.r2({ name: "iimos" }),
			ASSETS: bindings.assets(),
		},
	},
});
