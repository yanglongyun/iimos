// 本地服务:托管 ui/,提供画布接口和事件流。纯 Node,能脱开 launcher 单独跑(测试就是这么跑的)。
//
// 只听 127.0.0.1,每个接口都要令牌 —— 不然本机随便一个网页都能往这个端口发请求,借 agent 的 shell 在用户电脑上执行命令。
// 令牌由启动方生成,窗口打开时放在地址的 ?token= 里;界面每个请求带 x-iimos-token 头(iframe 用 ?token=)。
//
// 接口:
//   GET    /api/state                 模型配没配、项目列表
//   POST   /api/config                保存模型配置(responsesUrl / apiKey / model / contextWindow)
//   POST   /api/projects              { prompt, count } 新建画布,这句话成为对话的第一条,agent 生成 count 个方案
//   DELETE /api/projects/:id
//   GET    /api/projects/:id          整棵树 + 最近一页对话 + 压缩标记 + 运行态
//   GET    /api/projects/:id/messages?before=<id>   更早的消息
//   POST   /api/projects/:id/messages { text, node_id?, count? } 说一句话;选中节点作为上下文;count 表示要出几版
//   POST   /api/projects/:id/stop     停下这一轮
//   GET    /api/nodes/:id/html        渲染成完整网页(给 iframe)
//   GET    /api/nodes/:id/source      { node } 带源码
//   GET    /api/events                事件流(SSE):delta / item / state / usage / retry / compacting / compacted / error / node / config / project
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readConfig, writeConfig, publicConfig, modelReady } from './config.js';
import * as store from './db.js';
import { renderNode } from './render.js';
import { Chats } from './chat.js';

const UI_DIR = path.resolve(import.meta.dirname, '..', 'ui');
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon',
};
const BODY_LIMIT = 1024 * 1024;

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > BODY_LIMIT) { reject(Object.assign(new Error('请求太大'), { status: 413 })); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
            catch { reject(Object.assign(new Error('JSON 无效'), { status: 400 })); }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
}

function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = path.resolve(UI_DIR, rel);
    if (file !== UI_DIR && !file.startsWith(UI_DIR + path.sep)) return sendJson(res, 403, { error: '路径越界' });
    fs.readFile(file, (error, content) => {
        if (error) return sendJson(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
        res.end(content);
    });
}

function workspaceInfo(workspace) {
    let version = process.env.IIMOS_VERSION || '';
    if (!version) {
        try { version = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')).version || ''; } catch { /* 无 */ }
    }
    return { version };
}

/**
 * 起服务。返回 { url(带令牌,给窗口用), port, token, db, chats, close() }。
 * workspace:形态自己的目录;data:用户数据目录($IIMOS_DATA),数据库在 data/ramify/ramify.db。
 */
export async function startServer({ workspace, data, port = 0, token = crypto.randomBytes(24).toString('hex'), bin = process.env.IIMOS_BIN }) {
    fs.mkdirSync(data, { recursive: true });
    const db = store.openDatabase(path.join(data, 'ramify', 'ramify.db'));
    const subscribers = new Set();
    const broadcast = (event) => {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        for (const res of subscribers) res.write(line);
    };
    const chats = new Chats({ db, workspace, data, bin, emit: broadcast });

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (host !== '127.0.0.1' && host !== 'localhost') return sendJson(res, 403, { error: 'bad host' });
        if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);

        const given = req.headers['x-iimos-token'] || url.searchParams.get('token');
        if (given !== token) return sendJson(res, 401, { error: 'unauthorized' });

        try {
            const route = `${req.method} ${url.pathname}`;
            let match;
            if (route === 'GET /api/state') {
                return sendJson(res, 200, {
                    config: publicConfig(readConfig(data)),
                    workspace: workspaceInfo(workspace),
                    projects: store.listProjects(db).map((project) => ({ ...project, running: chats.running(project.id) })),
                });
            }
            if (route === 'POST /api/config') {
                const config = writeConfig(data, await readBody(req));
                broadcast({ type: 'config', config: publicConfig(config) });
                return sendJson(res, 200, { config: publicConfig(config) });
            }
            if (route === 'POST /api/projects') {
                const { prompt, count } = await readBody(req);
                if (!modelReady(readConfig(data))) return sendJson(res, 400, { error: '还没配置模型' });
                const { project, root } = store.createProject(db, { prompt });
                try {
                    chats.send(project.id, { text: project.prompt, count: count || 3 });
                } catch (error) {
                    store.deleteProject(db, project.id);
                    throw error;
                }
                broadcast({ type: 'project', id: project.id });
                return sendJson(res, 201, { project, root });
            }
            if ((match = route.match(/^DELETE \/api\/projects\/([\w-]+)$/))) {
                chats.stop(match[1]);
                if (!store.deleteProject(db, match[1])) return sendJson(res, 404, { error: '没有这个项目' });
                broadcast({ type: 'project', id: match[1], deleted: true });
                return sendJson(res, 200, { ok: true });
            }
            if ((match = route.match(/^GET \/api\/projects\/([\w-]+)$/))) {
                const tree = store.getTree(db, match[1]);
                if (!tree) return sendJson(res, 404, { error: '没有这个项目' });
                const page = store.listMessages(db, match[1]);
                return sendJson(res, 200, {
                    ...tree, messages: page.messages, has_more: page.has_more, compactions: store.listCompactions(db, match[1]),
                    running: chats.running(match[1]), partial: chats.partial(match[1]), tokens: store.getTokens(db, match[1]),
                });
            }
            if ((match = route.match(/^GET \/api\/projects\/([\w-]+)\/messages$/))) {
                if (!store.getProject(db, match[1])) return sendJson(res, 404, { error: '没有这个项目' });
                const before = Number(url.searchParams.get('before')) || null;
                return sendJson(res, 200, store.listMessages(db, match[1], { before }));
            }
            if ((match = route.match(/^POST \/api\/projects\/([\w-]+)\/messages$/))) {
                const { text, node_id, count } = await readBody(req);
                const item = chats.send(match[1], { text, nodeId: node_id || null, count: Number(count) || 0 });
                return sendJson(res, 201, { item });
            }
            if ((match = route.match(/^POST \/api\/projects\/([\w-]+)\/stop$/))) {
                return sendJson(res, 200, { stopped: chats.stop(match[1]) });
            }
            if ((match = route.match(/^GET \/api\/nodes\/([\w-]+)\/html$/))) {
                const node = store.getNode(db, match[1]);
                if (!node) return sendJson(res, 404, { error: '没有这个节点' });
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
                return res.end(renderNode(node));
            }
            if ((match = route.match(/^GET \/api\/nodes\/([\w-]+)\/source$/))) {
                const node = store.getNode(db, match[1]);
                return node ? sendJson(res, 200, { node }) : sendJson(res, 404, { error: '没有这个节点' });
            }
            if (route === 'GET /api/events') {
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
                res.write(': hello\n\n');
                subscribers.add(res);
                const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
                req.on('close', () => { clearInterval(ping); subscribers.delete(res); });
                return undefined;
            }
            return sendJson(res, 404, { error: 'not found' });
        } catch (error) {
            return sendJson(res, error.status || 500, { error: error.message || String(error) });
        }
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    const actual = server.address().port;
    return {
        port: actual,
        token,
        db,
        chats,
        url: `http://127.0.0.1:${actual}/?token=${token}`,
        async close() {
            chats.stopAll();
            for (const res of subscribers) res.end();
            await new Promise((resolve) => server.close(resolve));
            db.close();
        },
    };
}

// 单独跑:node server/index.js(开发、测试用)。数据放 IIMOS_DATA,不给就放 ./.data
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const workspace = process.env.IIMOS_WORKSPACE || path.resolve(import.meta.dirname, '..');
    const data = process.env.IIMOS_DATA || path.join(workspace, '.data');
    const server = await startServer({ workspace, data, port: Number(process.env.PORT) || 0, token: process.env.IIMOS_TOKEN || undefined });
    console.log(server.url);
}
