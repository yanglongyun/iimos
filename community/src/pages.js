// 页面:Worker 里直接拼 HTML,不要前端框架。风格跟出厂的 iimos 一样:黑底、等宽、一种绿。
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`);
const date = (iso) => String(iso || '').slice(0, 10);

const STYLE = `
:root { --bg:#050505; --bg-2:#0d0d0c; --ink:#e8e8e3; --ink-2:#b9b9b2; --dim:#6b6b66; --faint:#232321; --acc:#7cff9b; --cyan:#9fdcff;
  --mono:"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,"PingFang SC",monospace; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.7 var(--mono); }
a { color: inherit; text-decoration: none; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px 80px; }
header.top { display: flex; align-items: center; justify-content: space-between; height: 56px; border-bottom: 1px solid var(--faint); color: var(--dim); font-size: 12.5px; }
header.top b { color: var(--ink); font-weight: 500; }
header.top b i { color: var(--acc); font-style: normal; }
header.top nav { display: flex; gap: 18px; }
header.top nav a:hover, header.top nav a.on { color: var(--ink); }
.hero { padding: 56px 0 28px; }
.hero h1 { margin: 0; font-size: clamp(26px, 4.4vw, 40px); font-weight: 600; letter-spacing: -.01em; line-height: 1.25; }
.hero h1 em { font-style: normal; color: var(--acc); text-shadow: 0 0 18px rgba(124,255,155,.35); }
.hero p { color: var(--ink-2); max-width: 660px; margin: 14px 0 0; }
.cmd { display: flex; align-items: center; gap: 10px; margin-top: 18px; background: var(--bg-2); border: 1px solid var(--faint); border-radius: 6px; padding: 10px 14px; max-width: 660px; overflow-x: auto; }
.cmd code { flex: 1; white-space: nowrap; color: var(--ink); }
.cmd code::before { content: "$ "; color: var(--acc); }
.cmd button { flex-shrink: 0; background: none; border: 1px solid var(--faint); color: var(--dim); border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 8px; cursor: pointer; }
.cmd button:hover { color: var(--ink); }
.tabs { display: flex; gap: 14px; margin: 26px 0 16px; font-size: 12.5px; color: var(--dim); }
.tabs a.on { color: var(--acc); }
.tabs a.on::before { content: "› "; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; }
.card { display: block; border: 1px solid var(--faint); border-radius: 8px; overflow: hidden; background: var(--bg-2); transition: border-color .15s, transform .15s; }
.card:hover { border-color: #3b3b37; transform: translateY(-2px); }
.card .img { aspect-ratio: 16 / 11; background: #0a0a09; display: grid; place-items: center; overflow: hidden; border-bottom: 1px solid var(--faint); }
.card .img img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.card .img span { color: var(--faint); font-size: 40px; }
.card .body { padding: 12px 14px 14px; }
.card h3 { margin: 0; font-size: 14px; font-weight: 500; }
.card p { margin: 6px 0 0; color: var(--dim); font-size: 12px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 3.2em; }
.card .meta { display: flex; justify-content: space-between; margin-top: 10px; color: var(--dim); font-size: 11.5px; }
.card .meta b { color: var(--acc); font-weight: 400; }
.empty { color: var(--dim); padding: 40px 0; }
.detail { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 32px; padding-top: 36px; }
.detail .shot { border: 1px solid var(--faint); border-radius: 8px; overflow: hidden; background: #0a0a09; }
.detail .shot img { width: 100%; display: block; }
.detail .shot .none { aspect-ratio: 16 / 10; display: grid; place-items: center; color: var(--dim); }
.detail h1 { margin: 0; font-size: 26px; font-weight: 600; line-height: 1.3; }
.detail .by { color: var(--dim); font-size: 12.5px; margin-top: 6px; }
.detail h4 { margin: 24px 0 6px; color: var(--acc); font-weight: 500; font-size: 12px; }
.detail h4::before { content: "## "; color: var(--dim); }
.detail .story { white-space: pre-wrap; color: var(--ink-2); border-left: 2px solid var(--acc); padding-left: 12px; }
.detail .lineage a { color: var(--cyan); }
.detail .cmd { max-width: none; }
.detail details { color: var(--dim); font-size: 12px; }
.detail details summary { cursor: pointer; }
.detail details ul { list-style: none; padding: 6px 0 0; margin: 0; max-height: 320px; overflow: auto; }
.detail details li { display: flex; justify-content: space-between; gap: 12px; }
.note { color: var(--dim); font-size: 12px; margin-top: 10px; }
.kids { margin-top: 40px; }
footer { margin-top: 64px; padding-top: 18px; border-top: 1px solid var(--faint); color: var(--dim); font-size: 12px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
footer a:hover { color: var(--ink); }
@media (max-width: 820px) { .detail { grid-template-columns: 1fr; } header.top nav a.hide { display: none; } }
`;

const COPY = `document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(() => { const t = b.textContent; b.textContent = '已复制'; setTimeout(() => { b.textContent = t; }, 1200); }); });`;

function layout({ title, description, image, body, on = '' }) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" href="/icon.png"><style>${STYLE}</style></head><body><div class="wrap">
<header class="top"><a href="/"><b><i>iimos</i> 形态</b></a><nav><a href="/" class="${on === 'new' ? 'on' : ''}">最新</a><a href="/?sort=hot" class="${on === 'hot' ? 'on' : ''}">最多人换上</a><a class="hide" href="https://github.com/yanglongyun/iimos">GitHub</a></nav></header>
${body}
<footer><span>每个形态都是某个人的 iimos 在对话里一点点长出来的样子。</span><span><a href="https://iimos.ai">iimos.ai</a> · <a href="https://github.com/yanglongyun/iimos">开源</a></span></footer>
</div><script>${COPY}</script></body></html>`;
}

const cmd = (text) => `<div class="cmd"><code>${esc(text)}</code><button type="button" data-copy="${esc(text)}">复制</button></div>`;

function card(shape) {
    return `<a class="card" href="/s/${esc(shape.id)}"><div class="img">${shape.cover ? `<img loading="lazy" src="${esc(shape.cover)}" alt="">` : '<span>◇</span>'}</div>
<div class="body"><h3>${esc(shape.name)}</h3><p>${esc(shape.story || '没有留下长成这样的话。')}</p>
<div class="meta"><span>${esc(shape.author || '匿名')} · ${date(shape.createdAt)}</span><span><b>${shape.downloads}</b> 次换上</span></div></div></a>`;
}

export function listPage({ shapes, sort, origin }) {
    const body = `<section class="hero"><h1>同一颗种子,<em>长成了这些样子</em>。</h1>
<p>iimos 出厂只有一个对话框。界面、服务、工具、它自己的提示词都是它自己的源码 —— 你说一句,它就改自己。这里是大家的 iimos 长成的样子,看中哪个,一条命令换上;不喜欢,随时换回来。</p>
${cmd('iimos share "给你的形态起个名字" --story "你是怎么让它长成这样的"')}</section>
<div class="tabs"><a href="/" class="${sort === 'new' ? 'on' : ''}">最新</a><a href="/?sort=hot" class="${sort === 'hot' ? 'on' : ''}">最多人换上</a></div>
${shapes.length ? `<div class="grid">${shapes.map(card).join('')}</div>` : '<p class="empty">还没有人分享。第一个就是你。</p>'}`;
    return layout({ title: 'iimos 形态 —— 大家的 iimos 长成的样子', description: '每个 iimos 都会长成主人的样子。看中哪个,一条命令换上。', image: `${origin}/icon.png`, body, on: sort });
}

export function detailPage({ shape, children, origin }) {
    const lineage = shape.lineage.length
        ? `<h4>长自</h4><p class="lineage">${shape.lineage.map((x) => `<a href="/s/${esc(x.id)}">${esc(x.name || x.id)}</a>`).join(' → ')} → ${esc(shape.name)}</p>` : '';
    const files = (shape.files || []).map(([p, size]) => `<li><span>${esc(p)}</span><span>${kb(size)}</span></li>`).join('');
    const body = `<section class="detail">
<div class="shot">${shape.cover ? `<img src="${esc(shape.cover)}" alt="${esc(shape.name)} 的界面">` : '<div class="none">没有封面</div>'}</div>
<div><h1>${esc(shape.name)}</h1><div class="by">${esc(shape.author || '匿名')} · ${date(shape.createdAt)} · ${shape.downloads} 次换上${shape.seedVersion ? ` · 出厂 v${esc(shape.seedVersion)}` : ''}</div>
${shape.story ? `<h4>它是这样长出来的</h4><div class="story">${esc(shape.story)}</div>` : ''}
${lineage}
<h4>换上它</h4>${cmd(`iimos adopt ${shape.id}`)}
<p class="note">先给你看要换进来哪些文件,确认了才换。你现在的样子会留成一个分支,随时 <code>iimos rollback</code> 回来;对话、配置、key 不会被动。形态是代码,只换你信得过的。</p>
<h4>里面有什么</h4><details><summary>${shape.fileCount} 个文件 · ${kb(shape.size)}</summary><ul>${files}</ul></details>
</div></section>
${children.length ? `<section class="kids"><div class="tabs"><a class="on">从它长出来的</a></div><div class="grid">${children.map(card).join('')}</div></section>` : ''}`;
    return layout({
        title: `${shape.name} —— iimos 形态`,
        description: shape.story || `${shape.author || '有人'}的 iimos 长成的样子。`,
        image: shape.cover ? `${origin}${shape.cover}` : `${origin}/icon.png`,
        body,
    });
}

export function notFoundPage() {
    return layout({ title: '没有这个形态', description: '', body: '<section class="hero"><h1>没有这个形态。</h1><p>可能被作者删掉了。<a href="/" style="color:var(--acc)">看看别的 →</a></p></section>' });
}
