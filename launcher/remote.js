// 远程连接器。iimos 主动连到中继(机器不开端口),手机、远处的手经中继连进来。
//
// 每台设备配对时拿到自己的密钥,所有内容端到端加密;中继只转发密文。
// 设备发来的 HTTP 请求在这里解密,转给本机 127.0.0.1 上的应用(或救援页),响应(包括 SSE 事件流)分块加密送回。
// 远处的手(另一台电脑上的 hands)以「手」的身份连进来,挂到手的总线上。
//
// 数据:
//   $IIMOS_DATA/remote.json    { enabled, relay, instance, machineKey }   machineKey 证明「我是这个实例」,只有中继存它的哈希
//   $IIMOS_DATA/devices.json   { devices: [{ id, name, kind, secret, createdAt, lastSeen }] }   删掉一条就吊销
import fs from 'node:fs';
import path from 'node:path';

import { importKey, seal, open, randomId, newSecret, pairLink, b64url } from '../protocol/crypto.js';
import { CHUNK, DROP_HEADERS, REQUEST_LIMIT, REQUEST_TIMEOUT_MS, routeOf } from '../protocol/tunnel.js';

export const DEFAULT_RELAY = process.env.IIMOS_RELAY || 'https://relay.iimos.ai';
const PASS_HEADERS = ['content-type', 'cache-control', 'content-disposition', 'last-modified', 'etag'];

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
};

export function createRemote({ paths, log, targets, hub }) {
    const configFile = path.join(paths.data, 'remote.json');
    const devicesFile = path.join(paths.data, 'devices.json');
    const config = () => readJson(configFile, { enabled: false });
    const devices = () => readJson(devicesFile, { devices: [] }).devices;
    const saveDevices = (list) => writeJson(devicesFile, { devices: list });

    let ws = null;
    let connected = false;
    let stopped = true;
    let retry = null;
    let backoff = 1000;
    let heartbeat = null;
    /** 连接 id → { device, key, inflight: Map<请求 id, AbortController>, calls: Map<调用 id, {resolve,reject}>, detach } */
    const sessions = new Map();
    const keys = new Map();

    async function keyOf(device) {
        if (!keys.has(device.id)) keys.set(device.id, await importKey(device.secret));
        return keys.get(device.id);
    }

    async function send(conn, value) {
        const session = sessions.get(conn);
        if (!session?.device || !ws || ws.readyState !== 1) return;
        const frame = await seal(session.key, session.device.id, value);
        ws.send(JSON.stringify({ to: conn, ...frame }));
    }

    function closeSession(conn) {
        const session = sessions.get(conn);
        if (!session) return;
        for (const controller of session.inflight.values()) controller.abort();
        for (const pending of session.calls.values()) pending.reject(new Error('那只手断开了'));
        session.detach?.();
        sessions.delete(conn);
    }

    async function proxy(conn, msg) {
        const session = sessions.get(conn);
        const route = routeOf(msg.path);
        const base = targets()[route];
        if (!base) {
            await send(conn, { t: 'err', id: msg.id, error: route === 'app' ? '应用还没起来(可以打开救援页:/__recovery/)' : '救援页没开' });
            return;
        }
        const target = new URL(base);
        const headers = {};
        for (const [name, value] of Object.entries(msg.headers || {})) {
            if (!DROP_HEADERS.has(name.toLowerCase())) headers[name] = String(value);
        }
        headers['x-iimos-token'] = target.searchParams.get('token') || '';
        const controller = new AbortController();
        session.inflight.set(msg.id, controller);
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const body = msg.body ? b64url.decode(msg.body) : undefined;
            if (body && body.length > REQUEST_LIMIT) throw new Error('请求太大');
            const res = await fetch(`${target.origin}${msg.path}`, {
                method: msg.method || 'GET', headers, body, signal: controller.signal,
            });
            const isStream = (res.headers.get('content-type') || '').includes('text/event-stream');
            // 事件流是长连接,不受请求超时限制
            if (isStream) clearTimeout(timer);
            const out = {};
            for (const name of PASS_HEADERS) { const v = res.headers.get(name); if (v) out[name] = v; }
            await send(conn, { t: 'res', id: msg.id, status: res.status, headers: out });
            if (res.body) {
                for await (const chunk of res.body) {
                    for (let i = 0; i < chunk.length; i += CHUNK) {
                        await send(conn, { t: 'chunk', id: msg.id, data: b64url.encode(chunk.subarray(i, i + CHUNK)) });
                    }
                }
            }
            await send(conn, { t: 'end', id: msg.id });
        } catch (error) {
            if (!controller.signal.aborted || sessions.has(conn)) {
                await send(conn, { t: 'err', id: msg.id, error: controller.signal.aborted ? '超时或被取消' : String(error?.message || error) });
            }
        } finally {
            clearTimeout(timer);
            session?.inflight.delete(msg.id);
        }
    }

    function attachRemoteHand(conn, device, msg) {
        const session = sessions.get(conn);
        const tools = Array.isArray(msg.tools) ? msg.tools.map(String) : [];
        let seq = 0;
        session.detach = hub.attach({
            id: `remote:${device.id}`,
            name: msg.name || device.name,
            tools,
            remote: true,
            call: (tool, args) => new Promise((resolve, reject) => {
                const id = `c${++seq}`;
                const timer = setTimeout(() => { session.calls.delete(id); reject(new Error('远处的手 2 分钟没回应')); }, 120_000);
                session.calls.set(id, {
                    resolve: (v) => { clearTimeout(timer); resolve(v); },
                    reject: (e) => { clearTimeout(timer); reject(e); },
                });
                void send(conn, { t: 'call', id, tool, args });
            }),
        });
    }

    async function onInner(conn, msg) {
        const session = sessions.get(conn);
        if (msg.t === 'hello') {
            const list = devices();
            const device = list.find((d) => d.id === session.device.id);
            if (!device) return;
            device.lastSeen = new Date().toISOString();
            saveDevices(list);
            const t = targets();
            await send(conn, { t: 'welcome', instance: config().instance, app: Boolean(t.app), recovery: Boolean(t.recovery) });
            if (device.kind === 'hands' && msg.kind === 'hands') attachRemoteHand(conn, device, msg);
            return;
        }
        if (msg.t === 'req' && session.device.kind !== 'hands') return void proxy(conn, msg);
        if (msg.t === 'cancel') return void session.inflight.get(msg.id)?.abort();
        if (msg.t === 'result') {
            const pending = session.calls.get(msg.id);
            if (!pending) return;
            session.calls.delete(msg.id);
            if (msg.ok) pending.resolve(msg.value); else pending.reject(new Error(msg.error || '那只手做失败了'));
        }
    }

    async function onOuter(raw) {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.t === 'join') { sessions.set(msg.c, { device: null, key: null, inflight: new Map(), calls: new Map() }); return; }
        if (msg.t === 'leave') { closeSession(msg.c); return; }
        if (!msg.from || !msg.k) return;
        if (!sessions.has(msg.from)) sessions.set(msg.from, { device: null, key: null, inflight: new Map(), calls: new Map() });
        const session = sessions.get(msg.from);
        // 一条连接只认第一次用的那把钥匙;钥匙不在设备表里(没配对或被吊销)就当没听见
        if (session.device && session.device.id !== msg.k) return;
        const device = devices().find((d) => d.id === msg.k);
        if (!device) return;
        if (!session.device) { session.device = device; session.key = await keyOf(device); }
        let inner;
        try { inner = await open(session.key, msg); } catch { return; }
        await onInner(msg.from, inner).catch((error) => log('远程处理出错', error));
    }

    function connect() {
        const { enabled, relay, instance, machineKey } = config();
        if (stopped || !enabled || !instance) return;
        const url = `${relay.replace(/^http/, 'ws')}/m/${instance}/ws?role=machine&key=${encodeURIComponent(machineKey)}`;
        try { ws = new WebSocket(url); } catch (error) { log('连不上中继', error); return schedule(); }
        ws.onopen = () => {
            connected = true;
            backoff = 1000;
            log(`已连上中继 ${relay}`);
            heartbeat = setInterval(() => { try { ws.send('ping'); } catch { /* 断了等 onclose */ } }, 25_000);
        };
        ws.onmessage = (event) => { if (event.data !== 'pong') void onOuter(String(event.data)); };
        ws.onclose = (event) => {
            const was = connected;
            connected = false;
            clearInterval(heartbeat);
            for (const conn of [...sessions.keys()]) closeSession(conn);
            if (was) log(`和中继断开了(${event.code}${event.reason ? ` ${event.reason}` : ''})`);
            if (event.code === 4401) { log('中继拒绝了这个实例的密钥,远程连接停下'); return; }
            schedule();
        };
        ws.onerror = () => { /* onclose 会接着来 */ };
        return undefined;
    }

    function schedule() {
        if (stopped) return;
        clearTimeout(retry);
        retry = setTimeout(connect, backoff);
        retry.unref?.();
        backoff = Math.min(backoff * 2, 30_000);
    }

    function disconnect() {
        clearTimeout(retry);
        clearInterval(heartbeat);
        try { ws?.close(1000, 'bye'); } catch { /* 已断 */ }
        ws = null;
        connected = false;
    }

    async function enable({ relay } = {}) {
        const current = config();
        const next = {
            enabled: true,
            relay: String(relay || current.relay || DEFAULT_RELAY).replace(/\/+$/, ''),
            instance: current.instance || randomId(12),
            machineKey: current.machineKey || newSecret(),
        };
        // 换了中继:实例 id 和密钥跟着换,旧中继上的那份作废
        if (current.relay && current.relay !== next.relay) { next.instance = randomId(12); next.machineKey = newSecret(); }
        writeJson(configFile, next);
        disconnect();
        stopped = false;
        connect();
        return status();
    }

    function status() {
        const { enabled = false, relay = null, instance = null } = config();
        const online = new Set([...sessions.values()].map((s) => s.device?.id).filter(Boolean));
        return {
            enabled, relay, instance, connected,
            devices: devices().map(({ id, name, kind, createdAt, lastSeen }) => ({ id, name, kind, createdAt, lastSeen, online: online.has(id) })),
        };
    }

    const api = {
        status,
        enable,
        async disable() {
            writeJson(configFile, { ...config(), enabled: false });
            stopped = true;
            disconnect();
            return status();
        },
        /** 配对一台新设备。kind: 'device'(手机、别的浏览器)| 'hands'(另一台电脑上的手)。 */
        async pair({ name, kind = 'device' } = {}) {
            if (!config().enabled) await enable({});
            const { relay, instance } = config();
            const device = { id: randomId(9), name: String(name || (kind === 'hands' ? '电脑' : '手机')), kind: kind === 'hands' ? 'hands' : 'device', secret: newSecret(), createdAt: new Date().toISOString(), lastSeen: null };
            saveDevices([...devices(), device]);
            const link = pairLink({ relay, instance, device: device.id, secret: device.secret });
            let svg = null;
            try { const { default: QR } = await import('qrcode'); svg = await QR.toString(link, { type: 'svg', margin: 1 }); } catch { /* 没装 qrcode 就只给链接 */ }
            return { link, svg, device: { id: device.id, name: device.name, kind: device.kind } };
        },
        /** 吊销一台设备:删掉它的钥匙,正连着的立刻断开。 */
        revoke(id) {
            const list = devices();
            const next = list.filter((d) => d.id !== id);
            saveDevices(next);
            keys.delete(id);
            for (const [conn, session] of sessions) if (session.device?.id === id) closeSession(conn);
            return list.length - next.length;
        },
        /** 让中继给订阅了推送的设备发一条不带内容的推送(内容走加密隧道取)。 */
        async push() {
            if (!connected) return false;
            ws.send(JSON.stringify({ t: 'push' }));
            return true;
        },
    };

    return {
        api,
        async start() { stopped = false; connect(); },
        async stop() { stopped = true; disconnect(); },
    };
}
