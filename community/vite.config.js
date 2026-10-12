import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// 页面都是 Worker 里拼的 HTML;public/ 只有图标。src/ 引用 ../protocol/shape.js(和 launcher 共用一份格式)。
export default defineConfig({
  plugins: [cloudflare({ experimental: { newConfig: { cfBuildOutput: true } } })],
  build: { outDir: 'dist', emptyOutDir: true },
});
