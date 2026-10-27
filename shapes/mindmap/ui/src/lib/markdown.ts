// 对话里 agent 的回复用 Markdown 渲染:不渲染原始 HTML 和图片,危险协议的链接去掉。
import { marked } from 'marked';

const renderer = new marked.Renderer();
const renderLink = renderer.link.bind(renderer);
const unsafe = (value: string) => /^\s*(?:javascript|data|vbscript):/i.test(value);
renderer.html = () => '';
renderer.image = () => '';
renderer.link = (token: { href: string; title?: string | null; text: string }) => { if (unsafe(token.href)) token.href = '#'; return renderLink(token); };

export function renderMarkdown(source: string): string {
    return marked.parse(source, { async: false, breaks: true, gfm: true, renderer }) as string;
}
