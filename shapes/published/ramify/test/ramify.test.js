// 端到端:真起本地服务,用一个假的 Responses 服务当模型。不需要 launcher。
// 假模型按任务里的提示:先 add_nodes 建占位,再逐个 write_node,最后说一句话。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { startServer } from '../server/index.js';
import { renderNode } from '../server/render.js';
import { composeUserText, protocolItem } from '../server/chat.js';
import { outline } from '../server/agent/functions/nodes.js';

const cleanups = [];
// 倒着清理:先结束挂着的响应,再关服务
after(async () => { for (const fn of cleanups.reverse()) await fn(); });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ramify-'));

function respond(res, output) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const item of output) {
        if (item.type === 'message') for (const part of item.content) res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: part.text })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage: { total_tokens: 100 } } })}\n\n`);
    res.end();
}
const said = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const call = (name, args) => ({ type: 'function_call', call_id: `c_${Math.random().toString(36).slice(2)}`, name, arguments: JSON.stringify(args) });
const lastItem = (request) => request.input[request.input.length - 1];
const lastText = (request) => {
    const last = lastItem(request);
    if (last.type === 'message') return last.content.map((p) => p.text).join('');
    if (last.type === 'function_call_output') return JSON.parse(last.output).text;
    return '';
};
const lastUser = (request) => [...request.input].reverse().find((item) => item.type === 'message' && item.role === 'user').content.map((p) => p.text).join('');

async function fakeModel(behaviour) {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const request = JSON.parse(body);
            requests.push(request);
            behaviour(request, res, requests.length);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));
    return { requests, url: `http://127.0.0.1:${server.address().port}/v1/responses` };
}

async function boot(modelUrl) {
    const data = tmp();
    fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ responsesUrl: modelUrl, apiKey: 'test-key', model: 'fake', someoneElses: 'keep' }));
    const app = await startServer({ workspace: tmp(), data });
    cleanups.push(() => app.close());
    const http = async (method, url, body) => {
        const res = await fetch(`http://127.0.0.1:${app.port}${url}`, {
            method, headers: { 'x-iimos-token': app.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json().catch(() => null) };
    };
    const waitIdle = async (id) => {
        for (let i = 0; i < 400; i += 1) {
            const { body } = await http('GET', `/api/projects/${id}`);
            if (!body.running) return body;
            await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error('这一轮没有结束');
    };
    /** 订阅 SSE,把事件攒起来。 */
    const events = [];
    const stream = await fetch(`http://127.0.0.1:${app.port}/api/events?token=${app.token}`);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    (async () => {
        for (;;) {
            const { value, done } = await reader.read().catch(() => ({ done: true }));
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let at;
            while ((at = buffer.indexOf('\n\n')) >= 0) {
                const chunk = buffer.slice(0, at); buffer = buffer.slice(at + 2);
                const line = chunk.split('\n').find((l) => l.startsWith('data:'));
                if (line) events.push(JSON.parse(line.slice(5)));
            }
        }
    })();
    cleanups.push(() => reader.cancel().catch(() => {}));
    return { app, data, http, waitIdle, events };
}

/** 假 agent:任务里说要出几版就 add_nodes,拿到占位 id 后逐个 write_node,写完说一句话。 */
function agentBehaviour(written) {
    return (request, res) => {
        const text = lastText(request);
        const last = lastItem(request);
        if (last.type === 'message' && last.role === 'user') {
            const user = lastUser(request);
            const count = user.match(/count=(\d+)/)?.[1];
            const parent = user.match(/parent_id=([0-9a-f]{12})/)?.[1];
            if (count && parent) {
                const round = user.includes('round=修改要求') ? user.split('\n')[0] : undefined;
                return respond(res, [call('add_nodes', { parent_id: parent, count: Number(count), round })]);
            }
            return respond(res, [said('好的,我在。')]);
        }
        const pending = (text.match(/(?:占位:|没写:)([0-9a-f、]+)/)?.[1].split('、') || []).filter((id) => /^[0-9a-f]{12}$/.test(id) && !written.has(id));
        if (pending.length) {
            const id = pending[0];
            written.add(id);
            const types = ['html', 'markdown', 'svg'];
            const type = types[written.size % 3];
            const content = type === 'html' ? `<html><body><h1>方案 ${written.size}</h1></body></html>` : type === 'svg' ? '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>' : `# 方案 ${written.size}\n\n正文`;
            return respond(res, [call('write_node', { id, title: `方向 ${written.size}`, type, content })]);
        }
        return respond(res, [said('都写好了,三版走了三个方向。')]);
    };
}

test('令牌:没带或带错都拒', async () => {
    const model = await fakeModel(() => {});
    const { app } = await boot(model.url);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/state`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/state`, { headers: { 'x-iimos-token': 'nope' } })).status, 401);
});

test('首屏一句话 → 对话第一条 → 三个方案;再从一个方案分叉;对话存库、事件推送', async () => {
    const written = new Set();
    const model = await fakeModel(agentBehaviour(written));
    const { http, waitIdle, data, events } = await boot(model.url);

    const created = await http('POST', '/api/projects', { prompt: '做一张海报', count: 3 });
    assert.equal(created.status, 201);
    const projectId = created.body.project.id;
    const rootId = created.body.root.id;
    let snap = await waitIdle(projectId);

    // 树:根下三个方案
    const variants = snap.nodes.filter((n) => n.parent_id === rootId);
    assert.equal(variants.length, 3, JSON.stringify(snap.nodes));
    assert.ok(variants.every((n) => n.content && ['html', 'markdown', 'svg'].includes(n.type)), JSON.stringify(variants));
    // 对话:第一条是首屏那句话(display 是原话,发给模型的带「生成 3 个」的要求),最后一条是 agent 的总结
    assert.equal(snap.messages[0].role, 'user');
    assert.equal(snap.messages[0].display, '做一张海报');
    assert.ok(snap.messages[0].content[0].text.includes('生成 3 个'));
    assert.equal(snap.messages[0].node.count, 3);
    const lastMessage = snap.messages[snap.messages.length - 1];
    assert.equal(lastMessage.role, 'assistant');
    assert.ok(lastMessage.content[0].text.includes('三个方向'));
    assert.ok(snap.messages.some((m) => m.type === 'function_call' && m.name === 'add_nodes'));
    assert.equal(snap.messages.filter((m) => m.type === 'function_call' && m.name === 'write_node').length, 3);
    // 发给模型的条目没有界面字段
    assert.ok(model.requests.every((r) => r.input.every((item) => !('display' in item) && !('node' in item) && !('id' in item))));
    assert.ok(model.requests[0].instructions.includes('你是 ramify'));
    assert.deepEqual(model.requests[0].tools.map((t) => t.name).sort(), ['add_nodes', 'read_tree', 'shell', 'write_node']);
    // 事件:有增量、完整条目、节点变化、状态
    assert.ok(events.some((e) => e.type === 'delta' && e.project_id === projectId));
    assert.ok(events.some((e) => e.type === 'item' && e.item.type === 'function_call'));
    assert.ok(events.filter((e) => e.type === 'node' && e.node.content).length >= 3);
    assert.deepEqual(events.filter((e) => e.type === 'state').map((e) => e.running), [true, false]);

    for (const node of variants) {
        assert.equal((await http('GET', `/api/nodes/${node.id}/source`)).body.node.id, node.id);
        assert.ok(renderNode(node).startsWith('<!DOCTYPE html>'));
    }

    // 从第一个方案分叉两版:选中节点作为上下文;旧方案不动,新的长在「轮」节点下面
    const picked = variants[0];
    const branched = await http('POST', `/api/projects/${projectId}/messages`, { text: '更红一点', node_id: picked.id, count: 2 });
    assert.equal(branched.status, 201);
    assert.equal(branched.body.item.display, '更红一点');
    assert.equal(branched.body.item.node.id, picked.id);
    assert.ok(branched.body.item.content[0].text.includes(picked.content));
    snap = await waitIdle(projectId);
    const round = snap.nodes.find((n) => n.parent_id === picked.id);
    assert.ok(round && round.type === 'text', JSON.stringify(snap.nodes));
    assert.equal(round.title, '更红一点');
    const children = snap.nodes.filter((n) => n.parent_id === round.id);
    assert.equal(children.length, 2);
    assert.ok(children.every((n) => n.content && n.type !== 'error'), JSON.stringify(children));
    assert.equal(snap.nodes.find((n) => n.id === picked.id).content, picked.content);

    // 回复中不能再发
    // 项目列表的计数;config.json 里别人的字段原样还在
    const state = (await http('GET', '/api/state')).body;
    assert.equal(state.projects[0].done_count, 5);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).someoneElses, 'keep');
    assert.match(outline(snap.nodes), /^- \[.*做一张海报.*\n  - \[/);
    // 分页:limit 很大时没有更多
    const page = await http('GET', `/api/projects/${projectId}/messages?before=${snap.messages[2].id}`);
    assert.equal(page.body.messages.length, 2);
    assert.equal(page.body.has_more, false);
});

test('模型报错:这一轮失败,没写的占位标成 error;停下也一样;回复中再发 409', async () => {
    let mode = 'fail';
    const model = await fakeModel((request, res) => {
        if (mode === 'fail') {
            if (lastItem(request).type === 'message') return respond(res, [call('add_nodes', { parent_id: lastUser(request).match(/parent_id=([0-9a-f]{12})/)[1], count: 2 })]);
            res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: '模型拒绝了' } }));
        }
        cleanups.push(() => res.end());   // hang:一直不回,等被停下
    });
    const { http, waitIdle, events } = await boot(model.url);
    const created = await http('POST', '/api/projects', { prompt: '失败试试', count: 2 });
    const projectId = created.body.project.id;
    const snap = await waitIdle(projectId);
    const variants = snap.nodes.filter((n) => n.parent_id === created.body.root.id);
    assert.equal(variants.length, 2);
    assert.ok(variants.every((n) => n.type === 'error' && /还没写上内容/.test(n.content)), JSON.stringify(variants));
    assert.ok(events.some((e) => e.type === 'error' && /模型拒绝了/.test(e.message)));

    mode = 'hang';
    const second = await http('POST', '/api/projects', { prompt: '停下试试', count: 1 });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await http('POST', `/api/projects/${second.body.project.id}/messages`, { text: '再说一句' })).status, 409);
    assert.equal((await http('POST', `/api/projects/${second.body.project.id}/stop`)).body.stopped, true);
    const stopped = await waitIdle(second.body.project.id);
    assert.equal(stopped.running, false);
    assert.ok(events.some((e) => e.type === 'error' && e.message === '已停止'));
    assert.equal((await http('DELETE', `/api/projects/${second.body.project.id}`)).status, 200);
    assert.equal((await http('GET', `/api/projects/${second.body.project.id}`)).status, 404);
});

test('没配模型时不让生成', async () => {
    const data = tmp();
    const app = await startServer({ workspace: tmp(), data });
    cleanups.push(() => app.close());
    const res = await fetch(`http://127.0.0.1:${app.port}/api/projects`, { method: 'POST', headers: { 'x-iimos-token': app.token, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'x', count: 1 }) });
    assert.equal(res.status, 400);
});

test('composeUserText / protocolItem', () => {
    const text = composeUserText({ text: '更红', node: { id: 'abc', title: 'A', type: 'html', content: '<p>' }, count: 2 });
    assert.ok(text.startsWith('更红'));
    assert.ok(text.includes('abc') && text.includes('<p>') && text.includes('count=2'));
    assert.deepEqual(protocolItem({ id: 1, created_at: 'x', display: 'd', node: {}, type: 'message', role: 'user', content: [] }), { type: 'message', role: 'user', content: [] });
});
