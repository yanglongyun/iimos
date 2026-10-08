// 让 TypeScript 认得 esbuild 处理的样式与资源 import
declare module '*.css';
declare module '*.svg' { const url: string; export default url; }
declare module '*.png' { const url: string; export default url; }
