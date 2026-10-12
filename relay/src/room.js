// 一个 iimos 实例 = 一个 Durable Object。它只做三件事:
//   1. 记住「谁是这台 iimos」:第一次连上来的机器密钥存哈希,之后必须对得上(先到先得)
//   2. 在机器和设备之间转发帧。帧是端到端加密的,这里看不懂,也不存
//   3. 机器想找人时,给订阅了推送的设备发一条**不带内容**的推送
//
// 用 WebSocket 休眠接口:连接挂着但没消息时不计时长。
import { DurableObject } from 'cloudflare:workers';
import { sendPush } from './push.js';

const MAX_FRAME = 1024 * 1024;
const MAX_DEVICES = 16;

async function sha256(text) {
    const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return btoa(String.fromCharCode(...new Uint8Array(data)));
}
const randomId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));

export class Room extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }

    machine() { return this.ctx.getWebSockets('machine')[0] || null; }
    devices() { return this.ctx.getWebSockets('device'); }
    device(conn) { return this.ctx.getWebSockets(`c:${conn}`)[0] || null; }
    connOf(ws) { return this.ctx.getTags(ws).find((t) => t.startsWith('c:'))?.slice(2) || null; }

    async fetch(request) {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('需要 WebSocket', { status: 426 });
        const url = new URL(request.url);
        const role = url.searchParams.get('role');
        const [client, server] = Object.values(new WebSocketPair());

        if (role === 'machine') {
            const key = url.searchParams.get('key') || '';
            const hash = await sha256(key);
            const known = await this.ctx.storage.get('machine');
            if (key.length < 32 || (known && known !== hash)) {
                // 先接住再用 4401 关掉:客户端才看得到原因,不会傻傻重连
                server.accept();
                server.close(4401, 'bad machine key');
                return new Response(null, { status: 101, webSocket: client });
            }
            if (!known) await this.ctx.storage.put('machine', hash);
            for (const old of this.ctx.getWebSockets('machine')) old.close(4000, 'replaced');
            this.ctx.acceptWebSocket(server, ['machine']);
            // 已经连着的设备告诉机器,机器上线告诉设备
            for (const ws of this.devices()) {
                server.send(JSON.stringify({ t: 'join', c: this.connOf(ws) }));
                ws.send(JSON.stringify({ t: 'machine', online: true }));
            }
            return new Response(null, { status: 101, webSocket: client });
        }

        if (role === 'device') {
            if (this.devices().length >= MAX_DEVICES) return new Response('连着的设备太多了', { status: 429 });
            const conn = randomId();
            this.ctx.acceptWebSocket(server, ['device', `c:${conn}`]);
            const machine = this.machine();
            server.send(JSON.stringify({ t: 'machine', online: Boolean(machine) }));
            machine?.send(JSON.stringify({ t: 'join', c: conn }));
            return new Response(null, { status: 101, webSocket: client });
        }
        return new Response('role 只能是 machine 或 device', { status: 400 });
    }

    async webSocketMessage(ws, raw) {
        if (typeof raw !== 'string' || raw.length > MAX_FRAME) return;
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        const tags = this.ctx.getTags(ws);

        if (tags.includes('machine')) {
            if (msg.t === 'push') { this.ctx.waitUntil(this.push()); return; }
            if (msg.t === 'forget' && typeof msg.k === 'string') { await this.ctx.storage.delete(`push:${msg.k}`); return; }
            if (typeof msg.to === 'string' && msg.c) {
                const { to, ...frame } = msg;
                this.device(to)?.send(JSON.stringify(frame));
            }
            return;
        }

        const conn = this.connOf(ws);
        if (msg.t === 'subscribe' && typeof msg.k === 'string' && msg.sub?.endpoint) {
            // 订阅只记 endpoint 和密钥;推送不带内容,所以推送服务商也看不到你在聊什么
            await this.ctx.storage.put(`push:${msg.k}`, { endpoint: String(msg.sub.endpoint), keys: msg.sub.keys || null });
            return;
        }
        if (typeof msg.k === 'string' && msg.c) {
            this.machine()?.send(JSON.stringify({ from: conn, k: msg.k, iv: msg.iv, c: msg.c }));
        }
    }

    async webSocketClose(ws) {
        const tags = this.ctx.getTags(ws);
        if (tags.includes('machine')) {
            if (this.machine() === ws || !this.machine()) {
                for (const device of this.devices()) device.send(JSON.stringify({ t: 'machine', online: false }));
            }
            return;
        }
        this.machine()?.send(JSON.stringify({ t: 'leave', c: this.connOf(ws) }));
    }

    async webSocketError(ws) { await this.webSocketClose(ws); }

    async push() {
        const subs = await this.ctx.storage.list({ prefix: 'push:' });
        for (const [key, sub] of subs) {
            const status = await sendPush(this.env, sub).catch(() => 0);
            // 404 / 410:订阅失效了(用户关了通知、卸了 PWA)
            if (status === 404 || status === 410) await this.ctx.storage.delete(key);
        }
    }
}
