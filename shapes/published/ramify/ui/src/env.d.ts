// 让 TypeScript 认得 esbuild 处理的样式与资源 import
declare module '*.css';
declare module '*.svg' { const url: string; export default url; }
declare module '*.png' { const url: string; export default url; }
// 无框窗口的窗口钮(desktop/preload.cjs 注入;macOS 上没有,调用处用 ?. 兼容)
interface Window {
    iimosWin?: { minimize(): void; toggleMaximize(): void; close(): void };
}
// iimos add 装的 marked(ui/vendor/marked.js)没有类型声明,只声明用到的几样
declare module 'marked' {
    type LinkToken = { href: string; title?: string | null; text: string };
    class Renderer {
        link: (token: LinkToken) => string;
        html: (token: unknown) => string;
        image: (token: unknown) => string;
    }
    export const marked: {
        parse(source: string, options?: Record<string, unknown>): string;
        Renderer: typeof Renderer;
    };
}
