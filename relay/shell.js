// 手机上的外壳页。它是手机和你的 iimos 之间唯一的一根线:
//   - 配对链接 # 后面是这台设备的钥匙,存进 localStorage,随即从地址栏抹掉
//   - 连中继的 WebSocket,所有内容用钥匙加密,中继只看到密文
//   - 注册 Service Worker:里面 iframe 加载的就是你的 iimos 的界面,它发的每个请求被 SW 截住,经这里加密送过去
import { importKey, open, seal } from '../protocol/crypto.js';

const instance = location.pathname.match(/^\/m\/([\w-]+)/)?.[1];
const storeKey = `iimos:${instance}`;
const $ = (id) => document.getElementById(id);

function loadCreds() {
    const [device, secret] = location.hash.slice(1).split('.');
    if (device && secret) {
        localStorage.setItem(storeKey, JSON.stringify({ device, secret }));
        history.replaceState(null, '', location.pathname);
    }
    try { return JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch { return null; }
}

function setStatus(kind, text) {
    $('status').className = kind;
    $('statusText').textContent = text;
}
function note(text) {
    $('noteText').innerHTML = text;
    $('note').style.display = '';
    $('app').style.display = 'none';
}

const creds = instance && loadCreds();
if (!creds) {
    note('这个页面要用配对链接打开。在你的 iimos 里运行 <code>iimos pair</code>,用手机扫二维码。');
    setStatus('off', '没配对');
} else {
    void start();
}

async function start() {
    const key = await importKey(creds.secret);
    const send = async (value) => { if (ws?.readyState === 1) ws.send(JSON.stringify(await seal(key, creds.device, value))); };
    /** 请求 id → MessagePort(SW 那头等着的那个请求) */
    const inflight = new Map();
    let seq = 0;
    let ws = null;
    let backoff = 1000;
    let welcomed = false;
    let route = '/app/';

    // Service Worker:整个源只有一个,按「哪个 iframe 发的请求」分给对应的实例
    if (!('serviceWorker' in navigator)) { note('这个浏览器不支持 Service Worker,没法接你的界面。'); return; }
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
        // 第一次装上 SW,当前页还没被它接管;刷一次就好
        location.reload();
        return;
    }
    navigator.serviceWorker.controller.postMessage({ type: 'instance', id: instance });

    navigator.serviceWorker.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg?.type !== 'fetch' || !event.ports[0]) return;
        const port = event.ports[0];
        if (!welcomed) { port.postMessage({ type: 'err', error: '还没连上你的 iimos' }); return; }
        const id = `r${++seq}`;
        inflight.set(id, port);
        port.onmessage = (m) => { if (m.data?.type === 'cancel') { inflight.delete(id); void send({ t: 'cancel', id }); } };
        void send({ t: 'req', id, method: msg.method, path: msg.path, headers: msg.headers, body: msg.body || undefined });
    });

    function failAll(error) {
        for (const port of inflight.values()) port.postMessage({ type: 'err', error });
        inflight.clear();
    }

    function show(path) {
        route = path;
        const frame = $('app');
        frame.src = `/m/${instance}${path}`;
        frame.style.display = 'block';
        $('note').style.display = 'none';
    }

    async function onFrame(msg) {
        let inner;
        try { inner = await open(key, msg); } catch { return; }
        const port = inflight.get(inner.id);
        if (inner.t === 'welcome') {
            const first = !welcomed;
            welcomed = true;
            setStatus('on', '已连上');
            if (first) show(inner.app ? '/app/' : '/app/__recovery/');
            return;
        }
        if (!port) return;
        if (inner.t === 'res') port.postMessage({ type: 'res', status: inner.status, headers: inner.headers });
        else if (inner.t === 'chunk') port.postMessage({ type: 'chunk', data: inner.data });
        else if (inner.t === 'end') { port.postMessage({ type: 'end' }); inflight.delete(inner.id); }
        else if (inner.t === 'err') { port.postMessage({ type: 'err', error: inner.error }); inflight.delete(inner.id); }
    }

    function connect() {
        setStatus('', '连接中');
        ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/m/${instance}/ws?role=device`);
        let heartbeat = null;
        ws.onopen = () => { backoff = 1000; heartbeat = setInterval(() => ws.send('ping'), 25_000); };
        ws.onmessage = (event) => {
            if (event.data === 'pong') return;
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            if (msg.t === 'machine') {
                if (msg.online) void send({ t: 'hello', kind: 'device', name: navigator.userAgent.slice(0, 80) });
                else { setStatus('off', '你的 iimos 不在线'); failAll('你的 iimos 不在线'); if (!welcomed) note('你的 iimos 现在不在线(电脑睡着了,或者没开)。它一上线这里就会自己连上。'); }
                return;
            }
            if (msg.c) void onFrame(msg);
        };
        ws.onclose = () => {
            clearInterval(heartbeat);
            setStatus('off', '断开了,重连中');
            failAll('连接断开了');
            setTimeout(connect, backoff);
            backoff = Math.min(backoff * 2, 15_000);
        };
    }
    connect();

    // 菜单
    $('menu').onclick = () => { $('sheet').style.display = $('sheet').style.display === 'block' ? 'none' : 'block'; };
    $('openApp').onclick = () => { $('sheet').style.display = 'none'; show('/app/'); };
    $('openRecovery').onclick = () => { $('sheet').style.display = 'none'; show('/app/__recovery/'); };
    $('forget').onclick = () => { if (confirm('在这台设备上忘掉这个 iimos?之后要重新扫码。')) { localStorage.removeItem(storeKey); location.reload(); } };
    $('enablePush').onclick = async () => {
        $('sheet').style.display = 'none';
        try {
            const { key: vapid } = await (await fetch('/vapid')).json();
            if (!vapid) throw new Error('这个中继没开推送');
            if (await Notification.requestPermission() !== 'granted') throw new Error('没有通知权限');
            const reg = await navigator.serviceWorker.ready;
            const raw = Uint8Array.from(atob(vapid.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
            ws.send(JSON.stringify({ t: 'subscribe', k: creds.device, sub: sub.toJSON() }));
            alert('通知开好了。它找你的时候,这台设备会收到「iimos 找你」。');
        } catch (error) {
            alert(`没开成:${error.message}。iPhone 上要先「添加到主屏幕」,从主屏幕打开再开通知。`);
        }
    };
    void route;
}
