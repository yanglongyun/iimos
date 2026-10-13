// 浏览器:Chrome 插件(extension/)的本地宿主。插件经本机 WebSocket 连进来,命令在你登着账号的浏览器里执行。
//
// 配对:iimos 给一个 5 分钟有效、只能用一次的配对码,用户填进插件;配上之后插件拿到一个长期令牌
// (这里只存哈希)。只听 127.0.0.1,只认 chrome-extension:// 的来源,同时只连一个插件。
// 插件只操作用户共享给 iimos 的标签页和它自己新开的标签页(规则在插件里)。
import crypto from 'node:crypto';
import http from 'node:http';
import { WebSocketServer } from 'ws';

export const DEFAULT_PORT = Number(process.env.IIMOS_BROWSER_PORT) || 47231;
const PATH = '/api/browser/extension';
const SESSION = { id: 'iimos', title: 'iimos' };
const RUN = 'iimos';
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const BROWSER_ACTIONS = ['pair', 'status', 'tabs', 'open', 'goto', 'focus', 'close', 'screenshot', 'evaluate', 'click', 'type', 'press'];

/** store: { get() → { tokenHash, origin } | null, set(value) } */
export async function createBrowserHost({ store, log }) {
    let peer = null;
    let code = null;
    let seq = 0;
    const pending = new Map();

    const server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, 'http://x');
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        const origin = String(req.headers.origin || '');
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (url.pathname !== PATH || !local || !['127.0.0.1', 'localhost'].includes(host) || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => accept(ws, origin));
    });

    function accept(ws, origin) {
        let authed = false;
        const send = (value) => ws.readyState === 1 && ws.send(JSON.stringify(value));
        const deny = (error) => { send({ type: 'error', error }); ws.close(1008, 'denied'); };
        const authTimer = setTimeout(() => !authed && ws.close(1008, 'timeout'), 10_000);
        let alive = Date.now();
        const ping = setInterval(() => {
            if (Date.now() - alive > 45_000) { ws.terminate(); return; }
            send({ type: 'ping' });
        }, 20_000);
        ws.on('message', (raw) => {
            alive = Date.now();
            let msg;
            try { msg = JSON.parse(String(raw)); } catch { ws.close(1008, 'bad json'); return; }
            if (!authed) {
                const saved = store.get();
                if (msg.type === 'pair') {
                    if (!code || Date.now() > code.expires || typeof msg.code !== 'string' || msg.code.length !== code.value.length
                        || !crypto.timingSafeEqual(Buffer.from(msg.code), Buffer.from(code.value))) return deny('配对码不对或过期了,在 iimos 里重新生成一个');
                    code = null;
                    const token = crypto.randomBytes(32).toString('hex');
                    store.set({ tokenHash: hash(token), origin });
                    authed = true;
                    send({ type: 'connected', token });
                } else if (msg.type === 'authenticate') {
                    if (!saved || saved.origin !== origin || typeof msg.token !== 'string' || hash(msg.token) !== saved.tokenHash) return deny('插件的凭据失效了,请重新配对');
                    authed = true;
                    send({ type: 'connected' });
                } else {
                    return deny('请先配对');
                }
                clearTimeout(authTimer);
                if (peer && peer !== ws) peer.close(1000, 'replaced');
                peer = ws;
                log?.('浏览器插件连上了');
                send({ type: 'sessions', sessions: [SESSION] });
                return undefined;
            }
            if (msg.type === 'pong') return undefined;
            if (msg.type === 'sessions') return void send({ type: 'sessions', sessions: [SESSION] });
            if (msg.type === 'result') {
                const entry = pending.get(msg.id);
                if (!entry) return undefined;
                pending.delete(msg.id);
                clearTimeout(entry.timer);
                if (msg.error) entry.reject(new Error(msg.error)); else entry.resolve(msg.result);
            }
            if (msg.type === 'stopped') {
                for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(msg.error || '用户在插件里停下了')); }
                pending.clear();
            }
            return undefined;
        });
        ws.on('close', () => {
            clearTimeout(authTimer);
            clearInterval(ping);
            if (peer === ws) {
                peer = null;
                log?.('浏览器插件断开了');
                for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('浏览器插件断开了')); }
                pending.clear();
            }
        });
    }

    const port = await new Promise((resolve) => {
        server.once('error', () => { server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
        server.listen(DEFAULT_PORT, '127.0.0.1', () => resolve(server.address().port));
    });
    server.unref();
    const address = `http://127.0.0.1:${port}`;

    function request(method, args) {
        if (!peer) {
            return Promise.reject(new Error(store.get()
                ? '浏览器插件没连着:请用户打开 Chrome,确认 iimos 插件是开着的'
                : '还没装浏览器插件或没配对:先用 browser 的 pair 拿配对码,让用户在插件里填上'));
        }
        const id = `b${++seq}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('浏览器操作超时')); }, 60_000);
            pending.set(id, { resolve, reject, timer });
            peer.send(JSON.stringify({ type: 'request', runId: RUN, sessionId: SESSION.id, id, method, args }));
        });
    }

    return {
        address,
        async call({ action, ...args }) {
            if (action === 'pair') {
                code = { value: crypto.randomBytes(12).toString('hex'), expires: Date.now() + 5 * 60_000 };
                return { address, code: code.value, expiresIn: '5 分钟', hint: `让用户在 Chrome 的 iimos 插件里填「本机地址」${address} 和配对码` };
            }
            if (action === 'status') return { address, paired: Boolean(store.get()), connected: Boolean(peer) };
            if (!BROWSER_ACTIONS.includes(action)) throw new Error(`不认识的 action:${action}(可用:${BROWSER_ACTIONS.join(', ')})`);
            if (action !== 'tabs' && action !== 'open' && args.id !== undefined) args.id = String(args.id);
            return request(action, args);
        },
        stop() {
            if (peer?.readyState === 1) peer.send(JSON.stringify({ type: 'cancel', runId: RUN }));
            for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('浏览器操作已被用户停止')); }
            pending.clear();
        },
        close: () => new Promise((resolve) => { peer?.close(); wss.close(); server.close(() => resolve()); }),
    };
}
