// 出厂应用的端到端:真起本地服务,用一个假的 Responses 服务当模型。不需要 Electron。
// 这个目录不会被播种进用户的 workspace(launcher/seed.js 跳过 test/)。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { startServer } from '../server/index.js';
import { Conversation } from '../server/conversation.js';
import { compactCount, liveItems } from '../agent/compact.js';

// ── 假模型 ──────────────────────────────────────────────

/** 按 Responses 流式协议回一次:先发正文增量,最后 response.completed 带完整 output 与 usage。 */
function respond(res, output, usage = { total_tokens: 100 }) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const item of output) {
        if (item.type === 'message') {
            for (const part of item.content) res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: part.text })}\n\n`);
        }
    }
    res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage } })}\n\n`);
    res.end();
}
const said = (text) => ({ id: `msg_${Math.random()}`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

/** 起一个假模型,handler(request, res, n) 决定怎么回;记下每次收到的请求。 */
async function fakeModel(handler) {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const request = JSON.parse(body);
            requests.push({ auth: req.headers.authorization, request });
            handler(request, res, requests.length);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((r) => server.close(r)));
    return { requests, url: `http://127.0.0.1:${server.address().port}/v1/responses` };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-app-'));
const cleanups = [];
after(async () => { for (const fn of cleanups) await fn(); });

async function boot(data = tmp()) {
    const workspace = tmp();
    const app = await startServer({ workspace, data });
    cleanups.push(() => app.close());
    const call = async (method, url, body, headers = {}) => {
        const res = await fetch(`http://127.0.0.1:${app.port}${url}`, {
            method,
            headers: { 'x-iimos-token': app.token, 'content-type': 'application/json', ...headers },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json().catch(() => null) };
    };
    const idle = () => until(async () => !(await call('GET', '/api/state')).body.running);
    return { app, workspace, data, call, idle };
}

async function until(check, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error('等超时了');
}

// ── 接口与配置 ──────────────────────────────────────────

test('接口要令牌,也只认 127.0.0.1', async () => {
    const { app } = await boot();
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/state`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/state?token=wrong`)).status, 401);
    const rebinding = await new Promise((resolve) => {
        http.get({ host: '127.0.0.1', port: app.port, path: `/api/state?token=${app.token}`, headers: { host: 'evil.example' } }, (res) => resolve(res.statusCode));
    });
    assert.equal(rebinding, 403);
    // 界面本身不要令牌(里面没有秘密)
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/`)).status, 200);
});

test('模型配置:没配发不出去;key 不回显;上下文窗口填错了不收', async () => {
    const { call, data } = await boot();
    assert.equal((await call('POST', '/api/send', { text: 'hi' })).status, 400);
    const saved = await call('POST', '/api/config', { responsesUrl: 'http://x/v1/responses', apiKey: 'sk-secret-abcd1234', model: 'm' });
    assert.deepEqual(saved.body.config, { responsesUrl: 'http://x/v1/responses', model: 'm', contextWindow: 128000, hasKey: true, keyHint: 'sk-s••••••••1234', ready: true });
    assert.ok(!JSON.stringify((await call('GET', '/api/state')).body).includes('sk-secret-abcd1234'), '完整 key 不回传');
    await call('POST', '/api/config', { apiKey: '', model: 'm2' });   // 留空 key 表示不改
    assert.equal((await call('POST', '/api/config', { contextWindow: 100 })).status, 400);
    await call('POST', '/api/config', { contextWindow: '200000' });
    const config = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'));
    assert.deepEqual([config.apiKey, config.model, config.contextWindow], ['sk-secret-abcd1234', 'm2', 200000]);
    assert.equal((fs.statSync(path.join(data, 'config.json')).mode & 0o777), 0o600);
});

// ── 对话 ────────────────────────────────────────────────

test('一轮完整对话:调 shell → 拿结果 → 回话,全部落盘', async () => {
    const model = await fakeModel((request, res) => {
        const answered = request.input.some((item) => item.type === 'function_call_output');
        if (!answered) {
            return respond(res, [{ id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'shell', arguments: JSON.stringify({ command: 'echo hello > made.txt && cat made.txt' }) }]);
        }
        respond(res, [said('做好了')]);
    });
    const { call, workspace, data, idle } = await boot();
    await call('POST', '/api/config', { responsesUrl: model.url, apiKey: 'sk-1', model: 'fake' });

    assert.equal((await call('POST', '/api/send', { text: '建个文件' })).status, 202);
    assert.equal((await call('POST', '/api/send', { text: '再来' })).status, 409);
    await idle();

    assert.equal(fs.readFileSync(path.join(workspace, 'made.txt'), 'utf8'), 'hello\n');
    const { items } = (await call('GET', '/api/state')).body;
    assert.deepEqual(items.map((i) => i.type + (i.role ? `:${i.role}` : '')), ['message:user', 'function_call', 'function_call_output', 'message:assistant']);
    const result = JSON.parse(items[2].output);
    assert.equal(result.success, true);
    assert.match(result.text, /hello[\s\S]*\[退出码 0\]/);
    // 模型收到了 key、基础提示词、store:false,第二次请求带上了工具结果
    assert.equal(model.requests[0].auth, 'Bearer sk-1');
    assert.match(model.requests[0].request.instructions, /你是 iimos/);
    assert.equal(model.requests[0].request.store, false);
    assert.deepEqual(model.requests[0].request.tools.map((t) => t.name), ['shell', 'read', 'write', 'edit']);
    assert.equal(model.requests[1].request.input.at(-1).type, 'function_call_output');
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'conversation.json'), 'utf8')).items.length, 4);
});

test('模型服务 5xx:自动重试,界面能看到重试', async () => {
    const model = await fakeModel((request, res, n) => {
        if (n === 1) { res.writeHead(503); res.end('busy'); return; }
        respond(res, [said('好了')]);
    });
    const { app, call, idle } = await boot();
    await call('POST', '/api/config', { responsesUrl: model.url, apiKey: 'k', model: 'm' });
    const events = [];
    const stream = await fetch(`http://127.0.0.1:${app.port}/api/events?token=${app.token}`);
    const reader = stream.body.getReader();
    void (async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(new TextDecoder().decode(value)); } })();
    await call('POST', '/api/send', { text: 'hi' });
    await idle();
    await reader.cancel();
    assert.equal(model.requests.length, 2);
    assert.match(events.join(''), /"type":"retry"/);
    assert.equal((await call('GET', '/api/state')).body.items.at(-1).content[0].text, '好了');
});

test('重启打断了工具调用:下次加载补上结果,不留孤儿调用', () => {
    const data = tmp();
    fs.writeFileSync(path.join(data, 'conversation.json'), JSON.stringify({ items: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: '改一下然后重启' }] },
        { type: 'function_call', call_id: 'c1', name: 'shell', arguments: '{"command":"iimos restart"}' },
    ] }));
    const conversation = new Conversation({ workspace: tmp(), data, emit: () => {} });
    assert.equal(conversation.items.length, 3);
    assert.equal(conversation.items[2].call_id, 'c1');
    assert.equal(JSON.parse(conversation.items[2].output).success, false);
});

// ── 上下文压缩 ─────────────────────────────────────────

const user = (text) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const fcall = (id) => ({ type: 'function_call', call_id: id, name: 'shell', arguments: '{}' });
const fout = (id) => ({ type: 'function_call_output', call_id: id, output: '{"success":true,"text":"ok"}' });

test('压缩范围:留最后 keep 条,切点不拆开调用和结果', () => {
    // 太短:不压
    assert.equal(compactCount([user('a'), said('b'), user('c')], 20), 0);
    // 切点落在用户消息之前
    const turns = [];
    for (let i = 0; i < 10; i += 1) turns.push(user(`u${i}`), said(`a${i}`));
    assert.equal(compactCount(turns, 4), 16);
    // 一串调用中间不切:第 3 个调用还没返回时不能在它前面截断
    const tools = [user('u'), fcall('1'), fout('1'), fcall('2'), fcall('3'), fout('2'), fout('3'), said('done'), user('next'), said('ok')];
    const count = compactCount(tools, 2);
    assert.equal(count, 8);
    const pending = new Set();
    for (const item of tools.slice(0, count)) {
        if (item.type === 'function_call') pending.add(item.call_id);
        if (item.type === 'function_call_output') pending.delete(item.call_id);
    }
    assert.equal(pending.size, 0);
    // 上下文从最近一次压缩标记开始取:标记里的摘要消息 + 之后的条目
    const marked = [user('a'), { type: 'compaction', summary: 's', item: user('摘要') }, user('c'), { type: 'reasoning', summary: [] }];
    assert.deepEqual(liveItems(marked).map((i) => i.type), ['message', 'message', 'reasoning']);
    assert.equal(liveItems(marked)[0].content[0].text, '摘要');
});

test('一次完整的压缩:用量过线 → 写摘要 → 摘要替换早期上下文,原始条目不删', async () => {
    const model = await fakeModel((request, res) => {
        if (!request.tools.length) return respond(res, [said('- 用户要过一个记账本,做在 ui/ledger.js')]);
        respond(res, [said('好')], { total_tokens: 500 });
    });
    // 预先放 30 条历史,用量记成 9000(窗口填 10000,线在 7000)
    const data = tmp();
    const history = [];
    for (let i = 0; i < 15; i += 1) history.push(user(`第${i}句`), said(`回${i}`));
    fs.writeFileSync(path.join(data, 'conversation.json'), JSON.stringify({ tokens: 9000, items: history }));
    const { call, idle } = await boot(data);
    await call('POST', '/api/config', { responsesUrl: model.url, apiKey: 'k', model: 'm', contextWindow: 10000 });

    await call('POST', '/api/send', { text: '加一个按月统计' });
    await idle();

    const summaryRequest = model.requests.find((r) => !r.request.tools.length);
    assert.ok(summaryRequest, '先压缩再回答');
    assert.match(summaryRequest.request.input[0].content[0].text, /用户:第0句/);
    const main = model.requests.at(-1).request;
    assert.match(main.input[0].content[0].text, /^以下是此前对话的压缩摘要[\s\S]*ui\/ledger\.js/);
    assert.ok(main.input.length <= 22, '摘要 + 最后 20 条 + 新的一句');
    assert.equal(main.input.at(-1).content[0].text, '加一个按月统计');

    const state = (await call('GET', '/api/state')).body;
    const markers = state.items.filter((i) => i.type === 'compaction');
    assert.equal(markers.length, 1);
    assert.equal(state.items.length, 31 + 1 + 1, '原 30 条 + 新问 + 标记 + 新答 —— 一条不删');
    assert.equal(state.tokens, 500);
    // 下一轮的上下文从标记开始
    assert.equal(liveItems(state.items)[0].content[0].text.startsWith('以下是此前对话的压缩摘要'), true);
});

// ── 重启接续 ───────────────────────────────────────────

/** 假模型:第一句让 agent 跑一条会卡住的命令(模拟它执行 iimos restart 时被打断);重启接续时回一句收尾。 */
async function restartModel() {
    return fakeModel((request, res) => {
        // 接续请求:对话流里最后一条是「重启完成」消息
        const last = request.input.at(-1);
        if (last?.type === 'message' && /^\[launcher\] 重启完成/.test(last.content[0].text)) return respond(res, [said('重启好了,改动已经生效。')]);
        respond(res, [{ id: 'fc', type: 'function_call', call_id: 'c1', name: 'shell', arguments: JSON.stringify({ command: 'sleep 30' }) }]);
    });
}

test('重启接续:launcher 重启打断了这一轮,新进程起来后自动接着跑完', async () => {
    const model = await restartModel();
    const data = tmp();
    const first = await boot(data);
    await first.call('POST', '/api/config', { responsesUrl: model.url, apiKey: 'k', model: 'm' });
    await first.call('POST', '/api/send', { text: '改一下界面然后重启' });
    await until(async () => (await first.call('GET', '/api/state')).body.items.some((i) => i.type === 'function_call'));
    await first.app.close({ restarting: true });   // launcher 重启前的收尾
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'conversation.json'), 'utf8')).interrupted, true);

    const second = await boot(data);                // 新进程
    await second.idle();
    const { items } = (await second.call('GET', '/api/state')).body;
    assert.deepEqual(items.map((i) => i.type), ['message', 'function_call', 'function_call_output', 'restart', 'message']);
    assert.equal(items.at(-1).content[0].text, '重启好了,改动已经生效。');
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'conversation.json'), 'utf8'));
    assert.equal(saved.interrupted, false);
    assert.equal(saved.resumes, 0, '这一轮正常走完,计数清零');
});

test('重启接续:用户自己退出应用不算,下次打开不自动跑', async () => {
    const model = await restartModel();
    const data = tmp();
    const first = await boot(data);
    await first.call('POST', '/api/config', { responsesUrl: model.url, apiKey: 'k', model: 'm' });
    await first.call('POST', '/api/send', { text: '跑个长命令' });
    await until(async () => (await first.call('GET', '/api/state')).body.items.some((i) => i.type === 'function_call'));
    await first.app.close();
    const second = await boot(data);
    const state = (await second.call('GET', '/api/state')).body;
    assert.equal(state.running, false);
    assert.ok(!state.items.some((i) => i.type === 'restart'));
});

test('重启接续:连续太多次就停下,不陷进「改 → 重启」的循环', () => {
    const data = tmp();
    fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ responsesUrl: 'http://127.0.0.1:9/x', apiKey: 'k', model: 'm' }));
    fs.writeFileSync(path.join(data, 'conversation.json'), JSON.stringify({ interrupted: true, resumes: 3, items: [user('hi')] }));
    const conversation = new Conversation({ workspace: tmp(), data, emit: () => {} });
    conversation.resumeIfInterrupted();
    assert.equal(conversation.running, null);
    assert.deepEqual(conversation.items.at(-1).type, 'restart');
    assert.equal(conversation.items.at(-1).stopped, true);
});
