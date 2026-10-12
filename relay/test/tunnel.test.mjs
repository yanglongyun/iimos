// 端到端:假应用 ↔ launcher 的远程连接器 ↔ 中继(本地 vite dev 起的 workerd)↔ 脚本扮演的手机、远处的手。
// 先在 relay/ 里 npx vite dev --port 8799,再 RELAY=http://localhost:8799 node --test relay/test/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { createRemote } from '../../launcher/remote.js';
import { createHandsHub } from '../../launcher/hands-hub.js';
import { linkHands } from '../../hands/link.js';
import { importKey, open, parsePairLink, seal, b64url } from '../../protocol/crypto.js';

const RELAY = process.env.RELAY || 'http://localhost:8799';
const TOKEN = 'app-token-123';
let app;
let appUrl;
let remote;
let hub;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-remote-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
    app = http.createServer((req, res) => {
        if (req.headers['x-iimos-token'] !== TOKEN) { res.writeHead(401); res.end('unauthorized'); return; }
        if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>你好</p>'); return; }
        if (req.url === '/api/events') {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            let n = 0;
            const timer = setInterval(() => { res.write(`data: {"n":${++n}}\n\n`); if (n === 3) { clearInterval(timer); res.end(); } }, 50);
            return;
        }
        if (req.url === '/api/echo') {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(Buffer.concat(chunks)); });
            return;
        }
        if (req.url === '/big') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(Buffer.alloc(700_000, 7)); return; }
        res.writeHead(404); res.end();
    });
    await new Promise((r) => app.listen(0, '127.0.0.1', r));
    appUrl = `http://127.0.0.1:${app.address().port}/?token=${TOKEN}`;
    hub = createHandsHub({ log: () => {} });
    remote = createRemote({ paths: { data }, log: () => {}, targets: () => ({ app: appUrl, recovery: null }), hub });
    await remote.start();
    await remote.api.enable({ relay: RELAY });
    for (let i = 0; i < 50 && !remote.api.status().connected; i += 1) await sleep(100);
    assert.ok(remote.api.status().connected, 'launcher 连上了中继');
});
after(async () => { await remote.stop(); app.close(); });

/** 脚本扮演的手机:连中继、打招呼、发请求、收分块响应。 */
async function phone(link) {
    const { relay, instance, device, secret } = parsePairLink(link);
    const key = await importKey(secret);
    const ws = new WebSocket(`${relay.replace(/^http/, 'ws')}/m/${instance}/ws?role=device`);
    const waiters = new Map();
    let welcome;
    const welcomed = new Promise((r) => { welcome = r; });
    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.t === 'machine' && msg.online) ws.send(JSON.stringify(await seal(key, device, { t: 'hello', kind: 'device', name: 'test' })));
        if (!msg.c) return;
        const inner = await open(key, msg);
        if (inner.t === 'welcome') return welcome(inner);
        waiters.get(inner.id)?.(inner);
        return undefined;
    };
    await new Promise((r) => { ws.onopen = r; });
    let seq = 0;
    return {
        welcomed,
        ws,
        async request(method, p, body) {
            const id = `t${++seq}`;
            const parts = [];
            let head;
            const done = new Promise((resolve, reject) => {
                waiters.set(id, (m) => {
                    if (m.t === 'res') head = m;
                    if (m.t === 'chunk') parts.push(b64url.decode(m.data));
                    if (m.t === 'end') resolve();
                    if (m.t === 'err') reject(new Error(m.error));
                });
            });
            ws.send(JSON.stringify(await seal(key, device, { t: 'req', id, method, path: p, headers: { 'content-type': 'application/json' }, body: body ? b64url.encode(new TextEncoder().encode(body)) : undefined })));
            await done;
            return { status: head.status, headers: head.headers, body: Buffer.concat(parts) };
        },
    };
}

test('配对、打招呼、隧道里取页面:令牌由 iimos 补上,手机不知道', async () => {
    const { link } = await remote.api.pair({ name: '测试手机' });
    const p = await phone(link);
    const w = await p.welcomed;
    assert.equal(w.app, true);
    const res = await p.request('GET', '/');
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), '<p>你好</p>');
    p.ws.close();
});

test('事件流分块到达;POST 带正文;大响应分片', async () => {
    const { link } = await remote.api.pair({ name: '测试手机 2' });
    const p = await phone(link);
    await p.welcomed;
    const sse = await p.request('GET', '/api/events');
    assert.match(sse.body.toString(), /"n":1[\s\S]*"n":3/);
    const echo = await p.request('POST', '/api/echo', '{"hi":"你好"}');
    assert.deepEqual(JSON.parse(echo.body.toString()), { hi: '你好' });
    const big = await p.request('GET', '/big');
    assert.equal(big.body.length, 700_000);
    p.ws.close();
});

test('吊销之后,那台设备说什么 iimos 都当没听见', async () => {
    const { link, device } = await remote.api.pair({ name: '要吊销的' });
    const p = await phone(link);
    await p.welcomed;
    assert.equal(remote.api.revoke(device.id), 1);
    await sleep(200);
    const silent = await Promise.race([p.request('GET', '/').then(() => 'answered'), sleep(1500).then(() => 'silent')]);
    assert.equal(silent, 'silent');
    p.ws.close();
});

test('远处的手:经中继挂到手的总线上,能被调用', async () => {
    const { link } = await remote.api.pair({ name: '另一台电脑', kind: 'hands' });
    const calls = [];
    const linked = linkHands({ link, hand: { name: '另一台电脑', tools: ['notify'], call: async (tool, args) => { calls.push([tool, args]); return { shown: true }; } }, log: () => {} });
    for (let i = 0; i < 50 && !hub.api.list().some((h) => h.remote); i += 1) await sleep(100);
    assert.equal(hub.api.list().find((h) => h.remote)?.name, '另一台电脑');
    assert.deepEqual(await hub.api.call('notify', { title: 'hi' }), { shown: true });
    assert.deepEqual(calls, [['notify', { title: 'hi' }]]);
    linked.stop();
    for (let i = 0; i < 50 && hub.api.list().some((h) => h.remote); i += 1) await sleep(100);
    assert.equal(hub.api.list().length, 0, '断开后手摘掉了');
    await assert.rejects(hub.api.call('notify', {}), /没有手/);
});

test('别人拿同一个实例 id 冒充这台 iimos:中继拒绝(4401)', async () => {
    const { instance } = remote.api.status();
    const ws = new WebSocket(`${RELAY.replace(/^http/, 'ws')}/m/${instance}/ws?role=machine&key=${'x'.repeat(43)}`);
    const code = await new Promise((r) => { ws.onclose = (e) => r(e.code); });
    assert.equal(code, 4401);
});
