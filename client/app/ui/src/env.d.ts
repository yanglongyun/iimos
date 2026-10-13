// 让 TypeScript 认得 esbuild 处理的样式与资源 import
declare module '*.css';
declare module '*.svg' { const url: string; export default url; }
declare module '*.png' { const url: string; export default url; }
// 无框窗口的窗口钮(desktop/preload.cjs 注入;macOS 上没有,调用处用 ?. 兼容)
interface Window {
    iimosWin?: { minimize(): void; toggleMaximize(): void; close(): void };
}
