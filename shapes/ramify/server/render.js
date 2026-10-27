// 把节点内容渲染成一份可以放进 iframe 的完整 HTML。
// html 原样;markdown 经 marked 转成文章版式;svg 居中放在一块纸上。样式仿照独立版 ramify。
import { marked } from './vendor/marked.js';

const HEAD = (style) => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${style}</style></head>`;

const MD_STYLE = `
:root{color-scheme:light}*{box-sizing:border-box}
body{margin:0;background:#faf7f2;color:#2b2620;font:16px/1.75 Georgia,'Songti SC','Noto Serif SC',serif;-webkit-font-smoothing:antialiased}
main{max-width:720px;margin:0 auto;padding:56px 32px 88px}
h1,h2,h3,h4,h5,h6{color:#171310;line-height:1.3;margin:2em 0 .6em;font-weight:700}
h1{font-size:2rem;margin-top:.4em}h2{font-size:1.5rem;padding-bottom:.35em;border-bottom:1px solid #e7ded0}h3{font-size:1.2rem}
p{margin:.9em 0}a{color:#b3492f;text-decoration:underline;text-underline-offset:3px}strong{color:#171310}
blockquote{margin:1.4em 0;padding:.2em 1.2em;border-left:3px solid #c9a27a;background:#f3ece1;color:#5a4f42;border-radius:0 8px 8px 0}
code{font:.86em/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#efe8dc;padding:.15em .4em;border-radius:5px}
pre{background:#211d18;color:#e8e0d2;padding:18px 20px;border-radius:12px;overflow-x:auto;margin:1.4em 0}pre code{background:none;padding:0;color:inherit}
ul,ol{padding-left:1.5em;margin:.9em 0}li{margin:.3em 0}
table{border-collapse:collapse;width:100%;margin:1.4em 0;font-size:.94em}th,td{border:1px solid #e0d6c5;padding:.55em .8em;text-align:left}th{background:#f1eadd}
hr{border:0;border-top:1px solid #e0d6c5;margin:2.4em auto;width:52%}img{max-width:100%}
`;

const SVG_STYLE = `
html,body{margin:0;height:100%}
body{display:grid;place-items:center;background:#f4f1ea;background-image:radial-gradient(#00000010 1px,transparent 1px);background-size:18px 18px}
svg{max-width:92vw;max-height:92vh;filter:drop-shadow(0 10px 30px rgba(20,16,10,.14))}
`;

const ERROR_STYLE = `
html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fbeaea;color:#8a2f2f;font:14px/1.6 -apple-system,'PingFang SC',sans-serif;padding:24px;text-align:center}
`;

const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderNode(node) {
    const content = node.content || '';
    switch (node.type) {
        case 'html':
            return /^\s*<!doctype/i.test(content) ? content : `<!DOCTYPE html>${content}`;
        case 'markdown':
            return `${HEAD(MD_STYLE)}<body><main>${marked.parse(content, { async: false })}</main></body></html>`;
        case 'svg':
            return `${HEAD(SVG_STYLE)}<body>${content}</body></html>`;
        case 'error':
            return `${HEAD(ERROR_STYLE)}<body><div>${escapeHtml(content || '生成失败')}</div></body></html>`;
        default:
            return `${HEAD(MD_STYLE)}<body><main><h1>${escapeHtml(node.title)}</h1><p>${escapeHtml(content)}</p></main></body></html>`;
    }
}
