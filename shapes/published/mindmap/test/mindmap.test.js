// 端到端:真起本地服务,用一个假的 Responses 服务当模型。不需要 launcher。
// 假模型:先 read_map 拿到根主题 id,再 add_topics 搭三个分支。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { startServer } from '../server/index.js';
import { composeUserText, protocolItem } from '../server/chat.js';
import { outline } from '../server/agent/functions/map.js';

const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn(); });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mindmap-'));

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

/** 假 agent:首轮 read_map → add_topics;其他轮直接答一句。 */
function agentBehaviour() {
    return (request, res) => {
        const last = lastItem(request);
        if (last.type === 'message' && last.role === 'user') {
            if (lastUser(request).includes('这是一张新导图')) return respond(res, [call('read_map', {})]);
            return respond(res, [said('好的,这张图现在是这样。')]);
        }
        const text = lastText(request);
        if (last.type === 'function_call_output' && text.includes('导图') && !text.includes('已在')) {
            const root = text.match(/- \[([0-9a-f]{12})\]/)?.[1];
            return respond(res, [call('add_topics', {
                parent_id: root,
                topics: [
                    { title: '目标', note: '这一阶段要达成什么' },
                    { title: '用户', note: '为谁解决什么问题' },
                    { title: '路径', note: '怎么走到那里' },
                ],
            })]);
        }
        return respond(res, [said('先搭了目标、用户、路径三支,我们可以从任意一支继续。')]);
    };
}

test('令牌:没带或带错都拒', async () => {
    const model = await fakeModel(() => {});
    const { app } = await boot(model.url);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/state`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/state`, { headers: { 'x-iimos-token': 'nope' } })).status, 401);
});

test('一句话 → 首轮展开 → 三个分支;手动增改移删;事件推送', async () => {
    const model = await fakeModel(agentBehaviour());
    const { http, waitIdle, data, events } = await boot(model.url);

    const created = await http('POST', '/api/projects', { title: '产品规划' });
    assert.equal(created.status, 201);
    const projectId = created.body.project.id;
    const rootId = created.body.root.id;
    let snap = await waitIdle(projectId);

    const branches = snap.nodes.filter((n) => n.parent_id === rootId);
    assert.equal(branches.length, 3, JSON.stringify(snap.nodes));
    assert.deepEqual(branches.map((n) => n.title), ['目标', '用户', '路径']);
    assert.ok(branches.every((n) => n.note));
    assert.equal(snap.messages[0].role, 'user');
    assert.equal(snap.messages[0].display, '产品规划');
    assert.equal(snap.messages[0].node.id, rootId);
    assert.ok(snap.messages.some((m) => m.type === 'function_call' && m.name === 'read_map'));
    assert.ok(snap.messages.some((m) => m.type === 'function_call' && m.name === 'add_topics'));
    assert.equal(snap.messages[snap.messages.length - 1].role, 'assistant');
    assert.ok(model.requests.every((r) => r.input.every((item) => !('display' in item) && !('node' in item) && !('id' in item))));
    assert.ok(model.requests[0].instructions.includes('你是 mindmap'));
    assert.deepEqual(model.requests[0].tools.map((t) => t.name).sort(), ['add_topics', 'delete_topic', 'move_topic', 'read_map', 'shell', 'update_topic']);
    assert.ok(events.some((e) => e.type === 'delta' && e.project_id === projectId));
    assert.ok(events.some((e) => e.type === 'item' && e.item.type === 'function_call'));
    assert.ok(events.filter((e) => e.type === 'node').length >= 3);
    assert.deepEqual(events.filter((e) => e.type === 'state').map((e) => e.running), [true, false]);
    assert.match(outline(snap.nodes), /^- \[.*产品规划.*\n  - \[.*目标/s);

    // 同侧同级拖拽排序一次提交,即使旧 position 重复也要稳定落库。
    await http('PATCH', `/api/topics/${branches[2].id}`, { sort_order: branches[0].position });
    const reordered = await http('POST', `/api/topics/${branches[2].id}/reorder`, { before_id: branches[0].id });
    assert.equal(reordered.status, 200);
    assert.deepEqual(reordered.body.nodes.map((node) => node.position), [0, 1, 2]);
    assert.deepEqual(reordered.body.nodes.filter((node) => node.side === 'right').map((node) => node.title), ['路径', '目标']);
    assert.equal((await http('POST', `/api/topics/${branches[2].id}/reorder`, { before_id: branches[1].id })).status, 500);
    snap = (await http('GET', `/api/projects/${projectId}`)).body;
    assert.deepEqual(snap.nodes.filter((node) => node.parent_id === rootId && node.side === 'right').map((node) => node.title), ['路径', '目标']);
    assert.ok(events.some((event) => event.type === 'nodes' && event.nodes.some((node) => node.id === branches[2].id)));

    // 手动加一个主题
    const added = await http('POST', `/api/projects/${projectId}/topics`, { parent_id: branches[0].id, title: '关键结果', note: '可验证的结果' });
    assert.equal(added.status, 201);
    assert.equal(added.body.node.parent_id, branches[0].id);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(events.some((e) => e.type === 'node' && e.node.id === added.body.node.id));

    // 改标题和备注,以及画布引擎需要的折叠 / 左右 / 排序
    const updated = await http('PATCH', `/api/topics/${added.body.node.id}`, { title: '关键结果 KR', note: '三条可验证的结果', collapsed: true, side: 'left', sort_order: 2 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.node.title, '关键结果 KR');
    assert.equal(updated.body.node.collapsed, 1);
    assert.equal(updated.body.node.side, 'left');
    assert.equal(updated.body.node.position, 2);

    // 导图改名
    const renamed = await http('PATCH', `/api/projects/${projectId}`, { title: '产品规划 2027' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.project.title, '产品规划 2027');

    // 挪到另一个分支下
    const moved = await http('POST', `/api/topics/${added.body.node.id}/move`, { parent_id: branches[1].id });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.node.parent_id, branches[1].id);

    // 不能挪到自己的子树;不能删根
    const child = await http('POST', `/api/projects/${projectId}/topics`, { parent_id: added.body.node.id, title: '子项' });
    assert.equal((await http('POST', `/api/topics/${added.body.node.id}/move`, { parent_id: child.body.node.id })).status, 500);
    assert.equal((await http('DELETE', `/api/topics/${rootId}`)).status, 500);

    // 删子树
    const deleted = await http('DELETE', `/api/topics/${added.body.node.id}`);
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body.deleted.sort(), [added.body.node.id, child.body.node.id].sort());
    snap = await waitIdle(projectId);
    assert.ok(!snap.nodes.some((n) => n.id === added.body.node.id));
    assert.ok(events.some((e) => e.type === 'node_deleted' && e.id === added.body.node.id));

    // 项目列表的计数;config.json 里别人的字段原样还在
    const state = (await http('GET', '/api/state')).body;
    assert.equal(state.projects[0].topic_count, 3);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')).someoneElses, 'keep');
});

test('模型报错:这一轮失败;停下;回复中再发 409', async () => {
    let mode = 'fail';
    const model = await fakeModel((request, res) => {
        if (mode === 'fail') {
            res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: '模型拒绝了' } }));
        }
        cleanups.push(() => res.end());
    });
    const { http, waitIdle, events } = await boot(model.url);
    const created = await http('POST', '/api/projects', { title: '失败试试' });
    const projectId = created.body.project.id;
    await waitIdle(projectId);
    assert.ok(events.some((e) => e.type === 'error' && /模型拒绝了/.test(e.message)));

    mode = 'hang';
    const second = await http('POST', '/api/projects', { title: '停下试试' });
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
    const res = await fetch(`http://127.0.0.1:${app.port}/api/projects`, { method: 'POST', headers: { 'x-iimos-token': app.token, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x' }) });
    assert.equal(res.status, 400);
});

test('composeUserText / protocolItem', () => {
    const text = composeUserText({ text: '展开目标', node: { id: 'abc', title: '目标', note: '要达成什么' }, nodes: [{ id: 'abc', parent_id: null, title: '目标', note: '', position: 0 }] });
    assert.ok(text.startsWith('展开目标'));
    assert.ok(text.includes('abc') && text.includes('要达成什么'));
    assert.deepEqual(protocolItem({ id: 1, created_at: 'x', display: 'd', node: {}, type: 'message', role: 'user', content: [] }), { type: 'message', role: 'user', content: [] });
});
