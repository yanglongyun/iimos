// iimos.ai 的页面:首页、形态墙、形态详情。Worker 里直接拼 HTML,不要前端框架。风格跟出厂的 iimos 一样:黑底、等宽、一种绿。
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
/* 首页 */
.intro { padding: 72px 0 40px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 40px; align-items: end; }
.intro h1 { margin: 0; font-size: clamp(30px, 5.2vw, 54px); font-weight: 600; line-height: 1.15; letter-spacing: -.02em; }
.intro h1 em { font-style: normal; color: var(--acc); text-shadow: 0 0 22px rgba(124,255,155,.35); }
.intro p { color: var(--ink-2); margin: 18px 0 0; max-width: 620px; font-size: 15px; }
.get { border: 1px solid var(--faint); border-radius: 8px; background: var(--bg-2); padding: 18px; }
.get .btn { display: block; text-align: center; background: var(--acc); color: #04140a; font-weight: 600; border-radius: 6px; padding: 11px 0; }
.get .btn:hover { filter: brightness(1.08); }
.get small { display: block; margin-top: 10px; color: var(--dim); font-size: 11.5px; line-height: 1.7; }
.get small a { color: var(--ink-2); text-decoration: underline; text-decoration-color: var(--faint); text-underline-offset: 3px; }
.demo { border: 1px solid var(--faint); border-radius: 10px; overflow: hidden; background: #0a0a09; }
.demo img { display: block; width: 100%; }
.cap { color: var(--dim); font-size: 12px; margin: 10px 0 0; }
.cap b { color: var(--ink-2); font-weight: 400; }
.h { margin: 72px 0 18px; font-size: 13px; font-weight: 500; color: var(--acc); display: flex; justify-content: space-between; align-items: baseline; }
.h::before { content: "## "; color: var(--dim); }
.h span { flex: 1; }
.h a { color: var(--dim); font-weight: 400; font-size: 12px; }
.h a:hover { color: var(--ink); }
.feats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--faint); border: 1px solid var(--faint); border-radius: 8px; overflow: hidden; }
.feats div { background: var(--bg); padding: 18px 20px; }
.feats b { display: block; color: var(--ink); font-weight: 500; margin-bottom: 6px; }
.feats p { margin: 0; color: var(--dim); font-size: 12.5px; }
.tries { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tries div { border: 1px solid var(--faint); border-radius: 6px; padding: 10px 14px; color: var(--ink-2); background: var(--bg-2); }
.tries div::before { content: "› "; color: var(--acc); }
.install { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
.install > div { border: 1px solid var(--faint); border-radius: 8px; padding: 18px; }
.install b { font-weight: 500; }
.install p { color: var(--dim); font-size: 12.5px; margin: 6px 0 12px; }
.install pre { margin: 0; background: var(--bg-2); border: 1px solid var(--faint); border-radius: 6px; padding: 10px 12px; font: 12px/1.7 var(--mono); color: var(--ink-2); overflow-x: auto; }
.rescue { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 28px; align-items: center; }
.rescue img { width: 100%; border: 1px solid var(--faint); border-radius: 8px; display: block; }
.rescue p { color: var(--ink-2); margin: 0 0 10px; }
@media (max-width: 820px) { .intro, .rescue { grid-template-columns: 1fr; } .feats, .install, .tries { grid-template-columns: 1fr; } }
@media (max-width: 820px) { .detail { grid-template-columns: 1fr; } header.top nav a.hide { display: none; } }
.device { max-width: 560px; }
.device .btn, .device button.btn { display: inline-block; background: var(--acc); color: #04140a; font: inherit; font-weight: 600; border: 0; border-radius: 6px; padding: 10px 22px; cursor: pointer; }
.device .btn:hover { filter: brightness(1.08); }
.device .code { font-size: 32px; letter-spacing: .12em; color: var(--acc); margin: 18px 0 6px; }
.device .codeform { display: flex; gap: 10px; margin-top: 18px; }
.device .codeform input { flex: 1; background: var(--bg-2); border: 1px solid var(--faint); border-radius: 6px; color: var(--ink); font: inherit; font-size: 18px; letter-spacing: .1em; padding: 8px 12px; text-transform: uppercase; }
.device .note.err { color: #ff6b6b; }
.device form { margin-top: 16px; }
`;

const COPY = `document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(() => { const t = b.textContent; b.textContent = '已复制'; setTimeout(() => { b.textContent = t; }, 1200); }); });`;

function layout({ title, description, image, body, on = '' }) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" href="/icon.png"><style>${STYLE}</style><script async src="https://www.googletagmanager.com/gtag/js?id=G-QVMYW89RY7"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-QVMYW89RY7');</script></head><body><div class="wrap">
<header class="top"><a href="/"><b><i>iimos</i></b></a><nav><a href="/" class="${on === 'home' ? 'on' : ''}">首页</a><a href="/shapes" class="${on === 'shapes' ? 'on' : ''}">形态</a><a href="https://github.com/yanglongyun/iimos/releases">发布</a><a href="https://github.com/yanglongyun/iimos">GitHub</a></nav></header>
${body}
<footer><span>iimos · MIT 开源 · 你的机器,你的数据 · <a href="/privacy">隐私</a> · <a href="/terms">条款</a></span><span><a href="https://github.com/yanglongyun/iimos">github.com/yanglongyun/iimos</a></span></footer>
</div><script>${COPY}</script></body></html>`;
}

const cmd = (text) => `<div class="cmd"><code>${esc(text)}</code><button type="button" data-copy="${esc(text)}">复制</button></div>`;

function card(shape) {
    return `<a class="card" href="/s/${esc(shape.id)}"><div class="img">${shape.cover ? `<img loading="lazy" src="${esc(shape.cover)}" alt="">` : '<span>◇</span>'}</div>
<div class="body"><h3>${esc(shape.name)}</h3><p>${esc(shape.story || '没有留下长成这样的话。')}</p>
<div class="meta"><span>${esc(shape.author || '匿名')} · ${date(shape.createdAt)}</span><span><b>${shape.downloads}</b> 次换上</span></div></div></a>`;
}

const FEATURES = [
    ['你的电脑,你的数据', 'Agent、代码、数据都在你自己的电脑上。API Key 只存在本机,只发往你填的地址。'],
    ['一个对话,一个 shell', '出厂就这么多。对话会自动压缩,永远聊不满;别的能力,你要了它再给自己长。不想从零开始,就换上一个现成的形态,比如 agentic(类 ChatGPT 的对话列表 + 五个工具)。'],
    ['改完就生效', '界面改完先编译,编过了才重载窗口;编不过,窗口还是上一个能用的样子,错误交回给它接着改。'],
    ['形态能分享', '跟它说「把你现在的样子分享到 iimos.ai」或者「换成 iimos.ai 上的某个形态」,它自己去调网站的接口。'],
    ['模型用你自己的', '任何兼容 OpenAI Responses 协议的服务:填地址、API Key、模型名就行。'],
    ['改坏了能退回来', '每次启动前自动快照,新代码起不来就退回上一个好版本,坏掉的那版也留着。'],
];
const TRIES = ['换成 iimos.ai 上的形态 agentic', '右边加一个待办列表', '换成拟物风格,老式仪器面板那种', '给我做一个记账本', '把 agentic 形态里的浏览器工具搬过来'];
const SAY_SHARE = '把你现在的样子分享到 iimos.ai';
const sayAdopt = (id) => `换成 iimos.ai 上的形态 ${id}`;

export function homePage({ shapes, release, origin }) {
    const tick = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
    const body = `<section class="intro"><div>
<h1>一个可以<em>完全修改自己</em>的 Agent。</h1>
<p>出厂只有一个对话框。界面、服务、工具,甚至它自己的提示词,都是它自己的源码 —— 你要什么,它就把自己改成什么。所以世上没有两份一样的 iimos,每一份都是它主人的形状。</p>
</div><div class="get">
<a class="btn" href="${esc(release.dmg)}">下载 Mac 版${release.version ? ` · v${esc(release.version)}` : ''}</a>
<small>Apple 芯片${release.date ? ` · ${esc(release.date)} 发布` : ''} · MIT 开源 · <a href="${esc(release.exe || release.page)}">Windows 版</a><br><a href="${esc(release.page)}">更新说明</a> · <a href="https://github.com/yanglongyun/iimos">源码</a></small>
</div></section>
<div class="demo"><img src="/media/xp.gif" alt="iimos 把自己改成 Windows XP 桌面的录屏"></div>
<p class="cap"><b>「把自己改成 Windows XP 桌面」</b> —— 真实录屏,从出厂状态开始,中间快进。</p>

<h2 class="h"><span>它能做什么</span></h2>
<div class="feats">${FEATURES.map(([k, v]) => `<div><b>${esc(k)}</b><p>${tick(v)}</p></div>`).join('')}</div>

<h2 class="h"><span>打开后,直接说</span></h2>
<div class="tries">${TRIES.map((x) => `<div>${esc(x)}</div>`).join('')}</div>
<p class="cap">它会改自己的代码、重载窗口,然后告诉你多了什么、怎么用。</p>

<h2 class="h"><span>形态:现成的样子,直接换上</span><a href="/shapes">全部形态 →</a></h2>
${shapes.length ? `<div class="grid">${shapes.map(card).join('')}</div>` : '<p class="empty">还没有人分享。第一个就是你。</p>'}
<p class="cap">想把你的也放上来?跟你的 iimos 说:</p>${cmd(SAY_SHARE)}

<h2 class="h" id="install"><span>安装</span></h2>
<div class="install">
<div><b>Mac(Apple 芯片)</b><p>下载 dmg,第一次打开时在对话里填模型配置。关掉窗口它还在菜单栏,点一下就回来。</p><pre><a href="${esc(release.dmg)}">下载 iimos${release.version ? ` v${esc(release.version)}` : ''}.dmg</a></pre></div>
<div><b>Windows(x64)</b><p>下载 exe 安装包。还没有代码签名,第一次运行时 SmartScreen 会拦一下,点「更多信息 → 仍要运行」。关掉窗口它还在右下角托盘里。</p><pre><a href="${esc(release.exe || release.page)}">下载 iimos${release.version ? ` v${esc(release.version)}` : ''}.exe</a></pre></div>
</div>`;
    return layout({
        title: 'iimos —— 一个可以完全修改自己的 Agent',
        description: '出厂只有一个对话框。界面、服务、工具、提示词都是它自己的源码,你说要什么,它就把自己改成什么。住在你自己的机器上。',
        image: `${origin}/media/xp.gif`,
        body, on: 'home',
    });
}

export function listPage({ shapes, sort, origin }) {
    const body = `<section class="hero"><h1>同一颗种子,<em>长成了这些样子</em>。</h1>
<p>iimos 出厂只有一个对话框。界面、服务、工具、它自己的提示词都是它自己的源码 —— 你说一句,它就改自己。这里是大家的 iimos 长成的样子,看中哪个,跟你的 iimos 说一声就换上;不喜欢,随时换回来。把你的放上来,跟它说:</p>
${cmd(SAY_SHARE)}</section>
<div class="tabs"><a href="/shapes" class="${sort === 'new' ? 'on' : ''}">最新</a><a href="/shapes?sort=hot" class="${sort === 'hot' ? 'on' : ''}">最多人换上</a></div>
${shapes.length ? `<div class="grid">${shapes.map(card).join('')}</div>` : '<p class="empty">还没有人分享。第一个就是你。</p>'}`;
    return layout({ title: 'iimos 形态 —— 大家的 iimos 长成的样子', description: '每个 iimos 都会长成主人的样子。看中哪个,跟你的 iimos 说一声就换上。', image: `${origin}/icon.png`, body, on: 'shapes' });
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
<h4>换上它</h4><p class="note" style="margin-top:0">跟你的 iimos 说:</p>${cmd(sayAdopt(shape.id))}
<p class="note">它会先告诉你要换进来哪些文件,你点头了才换。换之前会记一个快照,不喜欢跟它说「换回去」就行;对话、配置、key 不会被动。形态是代码,只换你信得过的。</p>
<h4>里面有什么</h4><details><summary>${shape.fileCount} 个文件 · ${kb(shape.size)}</summary><ul>${files}</ul></details>
</div></section>
${children.length ? `<section class="kids"><div class="tabs"><a class="on">从它长出来的</a></div><div class="grid">${children.map(card).join('')}</div></section>` : ''}`;
    return layout({
        title: `${shape.name} —— iimos 形态`,
        description: shape.story || `${shape.author || '有人'}的 iimos 长成的样子。`,
        image: shape.cover ? `${origin}${shape.cover}` : `${origin}/icon.png`,
        body, on: 'shapes',
    });
}

export function notFoundPage() {
    return layout({ title: '没有这个形态', description: '', body: '<section class="hero"><h1>没有这个形态。</h1><p>可能被作者删掉了。<a href="/shapes" style="color:var(--acc)">看看别的 →</a></p></section>' });
}

/** 设备授权页:用户在这里用谷歌登录,同意自己的 iimos 以自己的名义发布形态。 */
export function devicePage({ user, code, device, done = false, error = '' }) {
    const who = user ? `<p class="note">已登录:${esc(user.name)}(${esc(user.email)}) · <a href="/auth/logout">换个账号</a></p>` : '';
    let main;
    if (done) {
        main = `<h1>好了。</h1><p>你的 iimos 现在可以用你的名义发布形态了。回到 iimos 里,它会自己接着做。</p>`;
    } else if (!user) {
        main = `<h1>让你的 iimos 用你的身份发布</h1><p>先用谷歌账号登录。登录后会让你确认 iimos 给你的那个码。</p>
<p><a class="btn" href="/auth/google?next=${encodeURIComponent(`/device${code ? `?code=${code}` : ''}`)}">用谷歌登录</a></p>`;
    } else if (device) {
        main = `<h1>确认这个码</h1><p>你的 iimos(「${esc(device.name)}」)想以 <b>${esc(user.name)}</b> 的名义在 iimos.ai 发布和删除形态。</p>
<p class="code">${esc(device.user_code)}</p><p class="note">和 iimos 里显示的码一样,再点同意。不一样就别点。</p>
<form method="post" action="/device"><input type="hidden" name="code" value="${esc(device.user_code)}"><button class="btn" type="submit">同意</button></form>`;
    } else {
        main = `<h1>输入 iimos 给你的码</h1><form method="get" action="/device" class="codeform"><input name="code" placeholder="XXXX-XXXX" autocomplete="off" autofocus value="${esc(code)}"><button class="btn" type="submit">下一步</button></form>`;
    }
    return layout({
        title: 'iimos —— 授权',
        description: '让你的 iimos 用你的身份在 iimos.ai 发布形态。',
        body: `<section class="hero device">${main}${error ? `<p class="note err">${esc(error)}</p>` : ''}${who}</section>`,
    });
}

/** 隐私政策、服务条款:谷歌登录要求有这两页。只写这个站真的做了什么。 */
const doc = (title, sections) => layout({
    title: `${title} —— iimos`,
    description: title,
    body: `<section class="hero doc"><h1>${esc(title)}</h1>${sections.map(([h, p]) => `<h4>${esc(h)}</h4><p>${esc(p)}</p>`).join('')}<p class="note">更新于 2026-10-15 · 有问题写信到 hi@iimos.ai</p></section>`,
});

export const privacyPage = () => doc('隐私政策', [
    ['iimos 本身', 'iimos 是装在你自己电脑上的应用。你的对话、模型配置、API Key 都只存在你的电脑上,不会发到 iimos.ai;API Key 只发往你自己填的模型服务地址。'],
    ['用谷歌登录时我们拿到什么', '只在你要发布或删除形态时才需要登录。登录后我们保存谷歌给的账号标识、邮箱、名字和头像地址,用来认出你、在你发布的形态上署名。我们不读取你的谷歌账号里的任何其他内容。'],
    ['你发布的形态', '形态是你的 iimos 的代码文件,发布后公开,任何人都能看到和下载,并显示你的名字。发布前网站会扫描像密钥的内容并拒绝,但你仍应自己确认里面没有私人信息。你可以随时删除自己发布的形态。'],
    ['令牌和会话', '浏览器登录用一个 cookie 保持会话;你的 iimos 拿到的是一个 API 令牌。两者在我们这里只存哈希,不存原文。'],
    ['统计', '网站页面用 Google Analytics 统计访问量。'],
    ['删除你的数据', '写信到 hi@iimos.ai,我们会删除你的账号和你发布的全部形态。'],
]);

export const termsPage = () => doc('服务条款', [
    ['iimos', 'iimos 以 MIT 许可证开源,按「现状」提供,不附带任何担保。它会按你的要求修改自己的代码、在你的电脑上执行命令 —— 后果由使用者自己承担。'],
    ['形态', '你发布的形态以 MIT 许可证公开,别人可以下载、修改、再分享。不要发布你无权公开的代码、他人的隐私或任何密钥。形态是代码,换上别人的形态前请自己确认可信。'],
    ['我们可以做的', '对违法、恶意或侵权的形态,我们可以不经通知删除,并停用发布它的账号。'],
    ['变更', '条款可能更新,更新后继续使用即视为同意。'],
]);
