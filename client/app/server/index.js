// 本地服务:托管 ui/,提供对话接口和事件流。纯 Node,能脱开 Electron 单独跑(测试就是这么跑的)。
//
// 只听 127.0.0.1,每个接口都要令牌 —— 不然本机随便一个网页都能往这个端口发请求,
// 借 agent 的 bash 在用户电脑上执行命令。令牌由启动方生成,窗口打开时放在地址的 ?token= 里。
//
// 接口:
//   GET  /api/state      模型配没配、正在跑没有、全部对话条目、正在流式输出的半句
//   POST /api/config     保存模型配置(responsesUrl / apiKey / model)
//   POST /api/send       发一句话,开始一轮(上一轮没跑完就 409)
//   POST /api/stop       停下当前这一轮
//   GET  /api/events     事件流(SSE):delta / item / state / error
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Conversation } from './conversation.js';
import { readConfig, writeConfig, publicConfig } from './config.js';

const UI_DIR = path.resolve(import.meta.dirname, '..', 'ui');

/** 界面启动日志里显示的版本:出厂版本号 + workspace 当前提交(读不到就算了,纯展示)。 */
function workspaceInfo(workspace) {
    let commit = '';
    try {
        const head = fs.readFileSync(path.join(workspace, '.git', 'HEAD'), 'utf8').trim();
        commit = head.startsWith('ref: ')
            ? fs.readFileSync(path.join(workspace, '.git', head.slice(5)), 'utf8').trim()
            : head;
    } catch { /* 不是 git 仓库(单独跑 server 时) */ }
    let version = process.env.IIMOS_VERSION || '';
    if (!version) {
        try { version = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')).version || ''; } catch { /* 无 */ }
    }
    return { version, commit: commit.slice(0, 7) };
}
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

/** ui/ 下的静态文件:index.html 和编译出来的 dist/。iimos reload 先编译 ui/src,再重载窗口。 */
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

/**
 * 起服务。返回 { url(带令牌,给窗口用), port, token, close() }。
 * workspace:agent 的工作目录(应用自己);data:用户数据目录。
 */
export async function startServer({ workspace, data, port = 0, token = crypto.randomBytes(24).toString('hex'), bin = process.env.IIMOS_BIN }) {
    fs.mkdirSync(data, { recursive: true });
    const subscribers = new Set();
    const broadcast = (event) => {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        for (const res of subscribers) res.write(line);
    };
    const conversation = new Conversation({ workspace, data, bin, emit: broadcast });

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        // 防 DNS rebinding:只认 127.0.0.1 / localhost 本身
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (host !== '127.0.0.1' && host !== 'localhost') return sendJson(res, 403, { error: 'bad host' });
        if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);

        const given = req.headers['x-iimos-token'] || url.searchParams.get('token');
        if (given !== token) return sendJson(res, 401, { error: 'unauthorized' });

        try {
            const route = `${req.method} ${url.pathname}`;
            if (route === 'GET /api/state') {
                return sendJson(res, 200, { config: publicConfig(readConfig(data)), workspace: workspaceInfo(workspace), ...conversation.snapshot() });
            }
            if (route === 'POST /api/config') {
                const config = writeConfig(data, await readBody(req));
                broadcast({ type: 'config', config: publicConfig(config) });
                return sendJson(res, 200, { config: publicConfig(config) });
            }
            if (route === 'POST /api/send') {
                const { text } = await readBody(req);
                conversation.send(String(text || ''));
                return sendJson(res, 202, { ok: true });
            }
            if (route === 'POST /api/stop') {
                conversation.stop();
                return sendJson(res, 200, { ok: true });
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
    // 上一轮如果是被 launcher 的重启打断的,接着跑完(界面连上来时会从 /api/state 看到它在跑)
    conversation.resumeIfInterrupted();
    return {
        port: actual,
        token,
        url: `http://127.0.0.1:${actual}/?token=${token}`,
        /** restarting:launcher 要重启应用 —— 正在跑的这一轮记下来,新进程起来后接着跑。 */
        async close({ restarting = false } = {}) {
            if (restarting) conversation.shutdown(); else conversation.stop();
            for (const res of subscribers) res.end();
            await new Promise((resolve) => server.close(resolve));
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
