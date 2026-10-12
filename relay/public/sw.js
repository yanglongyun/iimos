// iimos 中继的 Service Worker。
//
// 外壳页 /m/<实例>/ 里有个 iframe 加载 /m/<实例>/app/ —— 那是你自己 iimos 的界面。
// 那个 iframe 发的每一个请求(页面、脚本、/api/...、事件流)都在这里被截住,交给外壳页,
// 外壳页加密后经中继送到你的 iimos,响应一块块送回来。中继本身看不到任何内容。
const APP = /^\/m\/([\w-]+)\/app(\/.*)?$/;
const SHELL = /^\/m\/([\w-]+)\/?$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// 最近用的实例:推送不带内容,点通知时打开它
let lastInstance = null;
self.addEventListener('message', (event) => {
    if (event.data?.type === 'instance') {
        lastInstance = event.data.id;
        event.waitUntil(caches.open('iimos-meta').then((c) => c.put('/__last', new Response(lastInstance))));
    }
});

async function instanceFor(event, url) {
    const direct = url.pathname.match(APP);
    if (direct) return { id: direct[1], path: (direct[2] || '/') + url.search };
    if (!event.clientId || url.pathname.startsWith('/m/') || url.pathname === '/sw.js') return null;
    const client = await self.clients.get(event.clientId);
    const from = client && new URL(client.url).pathname.match(APP);
    return from ? { id: from[1], path: url.pathname + url.search } : null;
}

async function shellOf(id) {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    return all.find((c) => { const m = new URL(c.url).pathname.match(SHELL); return m && m[1] === id; }) || null;
}

const b64decode = (text) => {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
};
const b64encode = (buffer) => {
    const u8 = new Uint8Array(buffer);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function tunnel(target, request) {
    const shell = await shellOf(target.id);
    if (!shell) return new Response('这个页面要从 iimos 的配对链接打开。', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const headers = {};
    for (const [name, value] of request.headers) headers[name] = value;
    const body = ['GET', 'HEAD'].includes(request.method) ? null : b64encode(await request.arrayBuffer());
    const channel = new MessageChannel();
    return new Promise((resolve) => {
        let controller = null;
        let done = false;
        const stream = new ReadableStream({
            start(c) { controller = c; },
            cancel() { done = true; channel.port1.postMessage({ type: 'cancel' }); },
        });
        channel.port1.onmessage = ({ data }) => {
            if (data.type === 'res') resolve(new Response([204, 304].includes(data.status) ? null : stream, { status: data.status, headers: data.headers }));
            else if (data.type === 'chunk' && !done) controller.enqueue(b64decode(data.data));
            else if (data.type === 'end' && !done) { done = true; controller.close(); }
            else if (data.type === 'err') {
                if (!done) { done = true; try { controller.error(new Error(data.error)); } catch { /* 还没开始 */ } }
                resolve(new Response(String(data.error || '出错了'), { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
            }
        };
        request.signal?.addEventListener('abort', () => { if (!done) { done = true; channel.port1.postMessage({ type: 'cancel' }); } });
        shell.postMessage({ type: 'fetch', method: request.method, path: target.path, headers, body }, [channel.port2]);
    });
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    // 只有你的界面发的请求才走隧道;外壳页、中继自己的东西照常
    if (!APP.test(url.pathname) && !event.clientId) return;
    event.respondWith((async () => {
        const target = await instanceFor(event, url);
        return target ? tunnel(target, event.request) : fetch(event.request);
    })());
});

self.addEventListener('push', (event) => {
    event.waitUntil((async () => {
        const last = lastInstance || await caches.open('iimos-meta').then((c) => c.match('/__last')).then((r) => r?.text()).catch(() => null);
        await self.registration.showNotification('iimos', {
            body: 'iimos 找你',
            tag: 'iimos',
            renotify: true,
            icon: '/icon.png',
            data: { url: last ? `/m/${last}/` : '/' },
        });
    })());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = event.notification.data?.url || '/';
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const open = all.find((c) => new URL(c.url).pathname === target);
        if (open) return open.focus();
        return self.clients.openWindow(target);
    })());
});
