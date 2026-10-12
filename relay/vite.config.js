import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// 外壳页(index.html + shell.js,引用 ../protocol/crypto.js)和 Worker 一起打包;public/ 里是 sw.js 和图标。
export default defineConfig({
  plugins: [cloudflare({ experimental: { newConfig: { cfBuildOutput: true } } })],
  build: { outDir: 'dist', emptyOutDir: true },
});
