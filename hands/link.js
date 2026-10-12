// 把这台电脑的手借给远处的 iimos(大脑在服务器上的时候)。
//
// 远处的 iimos 用 `iimos pair --hands` 生成一个配对链接,这里填进来(`iimos hands link <链接>`),
// 本机的手就以「手」的身份经中继连过去,所有往来端到端加密。
import { importKey, open, parsePairLink, seal } from '../protocol/crypto.js';

export function linkHands({ link, hand, log }) {
    const { relay, instance, device, secret } = parsePairLink(link);
    let ws = null;
    let stopped = false;
    let backoff = 1000;
    let retry = null;
    let heartbeat = null;
    const keyPromise = importKey(secret);

    async function send(value) {
        if (!ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify(await seal(await keyPromise, device, value)));
    }

    async function onMessage(raw) {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.t === 'machine') { if (msg.online) void hello(); return; }
        if (!msg.c) return;
        let inner;
        try { inner = await open(await keyPromise, msg); } catch { return; }
        if (inner.t === 'welcome') { log?.(`手已连到远处的 iimos(${instance})`); return; }
        if (inner.t !== 'call') return;
        try {
            const value = await hand.call(inner.tool, inner.args || {});
            await send({ t: 'result', id: inner.id, ok: true, value });
        } catch (error) {
            await send({ t: 'result', id: inner.id, ok: false, error: String(error?.message || error) });
        }
    }

    const hello = () => send({ t: 'hello', kind: 'hands', name: hand.name, tools: hand.tools });

    function connect() {
        if (stopped) return;
        ws = new WebSocket(`${relay.replace(/^http/, 'ws')}/m/${instance}/ws?role=device`);
        ws.onopen = () => {
            backoff = 1000;
            void hello();
            heartbeat = setInterval(() => { try { ws.send('ping'); } catch { /* 等 onclose */ } }, 25_000);
        };
        ws.onmessage = (event) => { if (event.data !== 'pong') void onMessage(String(event.data)); };
        ws.onclose = () => {
            clearInterval(heartbeat);
            if (stopped) return;
            retry = setTimeout(connect, backoff);
            backoff = Math.min(backoff * 2, 30_000);
        };
        ws.onerror = () => {};
    }
    connect();

    return {
        instance,
        stop() {
            stopped = true;
            clearTimeout(retry);
            clearInterval(heartbeat);
            try { ws?.close(1000, 'bye'); } catch { /* 已断 */ }
        },
    };
}
