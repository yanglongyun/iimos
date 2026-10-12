// iimos 中继。手机(和远处的手)经这里连到你自己的 iimos;所有内容端到端加密,这里只转发。
//
//   /                              说明页
//   /m/<实例>/                     外壳页:拿配对链接 # 后面的钥匙,注册 Service Worker,把你的界面接进来
//   /m/<实例>/ws?role=...          WebSocket,交给这个实例的 Durable Object
//   /m/<实例>/manifest.webmanifest 装到主屏幕用(iOS 收推送要求先装到主屏幕)
//   /m/<实例>/app/...              你的 iimos 的界面 —— 正常情况下 Service Worker 截住,经隧道取;走到这里说明 SW 没接管
//   /vapid                         推送用的公钥
//   /sw.js                         Service Worker(静态资源)
export { Room } from './room.js';

const ID = /^\/m\/([\w-]{8,64})(\/.*)?$/;

const page = (title, body) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:15px/1.7 -apple-system,system-ui,sans-serif;background:#050505;color:#ddd;max-width:560px;margin:15vh auto;padding:0 20px">${body}</body>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/vapid') return Response.json({ key: env.VAPID_PUBLIC || null });
        const match = url.pathname.match(ID);
        if (!match) {
            if (url.pathname === '/' || url.pathname === '') {
                return page('iimos 中继', '<h2>iimos 中继</h2><p>这里把手机连到你自己电脑(或服务器)上的 iimos。内容端到端加密,中继只转发看不懂的密文,也不存任何东西。</p><p>在 iimos 里运行 <code>iimos pair</code>,用手机扫出来的二维码打开。</p><p><a style="color:#7cff9b" href="https://github.com/yanglongyun/iimos">github.com/yanglongyun/iimos</a></p>');
            }
            return env.ASSETS.fetch(request);
        }
        const [, instance, rest = '/'] = match;
        if (rest === '/ws') return env.ROOMS.get(env.ROOMS.idFromName(instance)).fetch(request);
        if (rest === '/manifest.webmanifest') {
            return Response.json({
                name: 'iimos', short_name: 'iimos', start_url: `/m/${instance}/`, scope: `/m/${instance}/`, display: 'standalone',
                background_color: '#050505', theme_color: '#050505',
                icons: [{ src: '/icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' }],
            }, { headers: { 'content-type': 'application/manifest+json' } });
        }
        if (rest.startsWith('/app')) {
            return page('iimos', `<p>这个页面要从配对链接打开(<a style="color:#7cff9b" href="/m/${instance}/">/m/${instance}/</a>)。如果刚打开过,刷新一下。</p>`);
        }
        if (rest === '/' || rest === '') {
            // 外壳页就是静态的 index.html;不缓存,保证换版本立刻生效
            const res = await env.ASSETS.fetch(new Request(new URL('/', url), request));
            const out = new Response(res.body, res);
            out.headers.set('cache-control', 'no-cache');
            out.headers.set('referrer-policy', 'no-referrer');
            return out;
        }
        return new Response('not found', { status: 404 });
    },
};
