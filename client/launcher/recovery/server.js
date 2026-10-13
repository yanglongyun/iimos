// 救援服务。不加载应用的任何代码:应用改坏了,这里照样能开。
//
// 一个纯 Node 的网页服务(127.0.0.1 + 令牌),由宿主开窗口加载。
// 所有路径都在 /__recovery/ 下面,远程隧道按这个前缀把请求分给这里而不是应用。
//
//   GET  /__recovery/                 页面
//   GET  /__recovery/api/status       版本史、分支、回滚记录、日志尾巴
//   POST /__recovery/api/rollback     { ref } 回到某个版本(当前样子留成分支)
//   POST /__recovery/api/factory      恢复出厂
//   POST /__recovery/api/snapshot     { message }
//   POST /__recovery/api/restart      重启应用
//   POST /__recovery/api/open-folder  在访达里打开 workspace(只有桌面宿主能做)
//   POST /__recovery/api/chat         { text } 和救援 agent 说一句(结果走事件流)
//   POST /__recovery/api/stop         停下救援 agent
//   POST /__recovery/api/reset-chat   清空救援对话
//   GET  /__recovery/api/events       事件流(SSE):text / tool / result / done / error / refresh
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as snap from '../snapshot.js';
import * as seed from '../seed.js';
import { readLedger } from '../guardian.js';
import { runRescue, readCreds } from './agent.js';

export const PREFIX = '/__recovery';
const PAGE = path.join(import.meta.dirname, 'index.html');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const tail = (file, bytes = 6000) => {
    try {
        const size = fs.statSync(file).size;
        const fd = fs.openSync(file, 'r');
        const buffer = Buffer.alloc(Math.min(bytes, size));
        fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
        fs.closeSync(fd);
        return buffer.toString('utf8');
    } catch { return ''; }
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('JSON 无效')); }
        });
        req.on('error', reject);
    });
}

/**
 * ctx: { paths, seedDir, version, log, contract, reason(): string, restart(), openFolder?() }
 * 返回 { url(带令牌), port, token, refresh(), close() }
 */
export async function startRecovery(ctx) {
    const token = crypto.randomBytes(24).toString('hex');
    const subscribers = new Set();
    let history = [];
    let running = null;

    const emit = (type, data) => {
        const line = `data: ${JSON.stringify({ type, data })}\n\n`;
        for (const res of subscribers) res.write(line);
    };

    function instructions() {
        let contract = '';
        try { contract = fs.readFileSync(ctx.contract, 'utf8'); } catch { /* 没有就算了 */ }
        let agentDoc = '';
        try { agentDoc = fs.readFileSync(path.join(ctx.paths.workspace, 'AGENT.md'), 'utf8').slice(0, 20_000); } catch { /* 可能就是它坏了 */ }
        return [
            '你在 iimos 的救援页里。用户的应用可能被改坏了起不来,你的任务是帮用户把它修好。',
            '先看清楚:iimos status、iimos log、launcher 日志(下面有尾巴)、最近改了什么(iimos diff good)。',
            '修法有两种:直接改文件修好 bug;或者 iimos rollback <版本> 回到能用的版本。拿不准时先问用户。',
            '修完用 iimos snapshot 记一笔,然后告诉用户点「重启应用」。',
            `\n## 为什么进了救援\n${ctx.reason() || '(未知)'}`,
            `\n## launcher 日志(最后一段)\n${tail(ctx.paths.log, 4000)}`,
            `\n## launcher 契约\n${contract}`,
            agentDoc ? `\n## 应用自己写的 AGENT.md\n${agentDoc}` : '',
        ].join('\n');
    }

    async function status() {
        const ws = ctx.paths.workspace;
        const ledger = readLedger(ctx.paths.ledger);
        let branches = [];
        try {
            const { default: git } = await import('isomorphic-git');
            const names = (await git.listBranches({ fs, dir: ws })).filter((b) => b !== 'main').sort().reverse().slice(0, 20);
            branches = await Promise.all(names.map(async (name) => ({ name, oid: await snap.resolve(ws, `refs/heads/${name}`) })));
        } catch { /* 没仓库 */ }
        return {
            reason: ctx.reason(),
            version: ctx.version,
            workspace: ws,
            head: await snap.head(ws),
            good: await snap.resolve(ws, 'refs/tags/good'),
            log: await snap.log(ws, 40),
            branches,
            boot: ledger.boot || null,
            lastRollback: ledger.lastRollback || null,
            pendingUpgrade: seed.readPending(ws),
            hasCreds: Boolean(readCreds(ctx.paths.data)),
            canOpenFolder: Boolean(ctx.openFolder),
            launcherLog: tail(ctx.paths.log),
        };
    }

    async function chat(text) {
        if (running) throw Object.assign(new Error('上一句还没说完'), { status: 409 });
        running = new AbortController();
        const env = { ...process.env, PATH: `${ctx.paths.bin}${path.delimiter}${process.env.PATH || '/usr/bin:/bin'}` };
        delete env.ELECTRON_RUN_AS_NODE;
        const signal = running.signal;
        void (async () => {
            try {
                await runRescue({
                    history, text, workspace: ctx.paths.workspace, dataDir: ctx.paths.data, env,
                    instructions: instructions(), signal, emit,
                });
            } catch (error) {
                emit('error', error?.name === 'AbortError' ? '已停止' : String(error?.message || error));
            } finally {
                running = null;
                emit('refresh');
            }
        })();
    }

    const actions = {
        'GET /api/status': () => status(),
        'POST /api/rollback': async ({ ref }) => {
            const ws = ctx.paths.workspace;
            const oid = await snap.resolve(ws, String(ref));
            if (!oid) throw Object.assign(new Error(`找不到版本:${ref}`), { status: 400 });
            await snap.resetHard(ws, oid, { saveAs: `before-rollback-${stamp()}` });
            ctx.log(`救援:回滚到 ${oid.slice(0, 8)}`);
            return status();
        },
        'POST /api/factory': async () => {
            const saveAs = `before-factory-${stamp()}`;
            await seed.replace({ seedDir: ctx.seedDir, workspace: ctx.paths.workspace, version: ctx.version, message: `恢复出厂 v${ctx.version}`, saveAs });
            seed.clearPending(ctx.paths.workspace);
            ctx.log(`救援:恢复出厂,原来的样子留在 ${saveAs}`);
            return status();
        },
        'POST /api/snapshot': async ({ message }) => ({ oid: await snap.commitAll(ctx.paths.workspace, String(message || '救援快照')) }),
        'POST /api/restart': () => { setTimeout(() => void ctx.restart(), 200); return { ok: true }; },
        'POST /api/open-folder': () => { if (!ctx.openFolder) throw Object.assign(new Error('这台机器没有桌面'), { status: 400 }); ctx.openFolder(); return { ok: true }; },
        'POST /api/chat': async ({ text }) => { await chat(String(text || '')); return { ok: true }; },
        'POST /api/stop': () => { running?.abort(); return { ok: true }; },
        'POST /api/reset-chat': () => { running?.abort(); history = []; return { ok: true }; },
    };

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const send = (code, value) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (host !== '127.0.0.1' && host !== 'localhost') return send(403, { error: 'bad host' });
        if (!url.pathname.startsWith(PREFIX)) return send(404, { error: 'not found' });
        const rel = url.pathname.slice(PREFIX.length) || '/';
        if (rel === '/' || rel === '/index.html') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
            return fs.createReadStream(PAGE).pipe(res);
        }
        const given = req.headers['x-iimos-token'] || url.searchParams.get('token');
        if (given !== token) return send(401, { error: 'unauthorized' });
        if (rel === '/api/events') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
            res.write(': hello\n\n');
            subscribers.add(res);
            const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
            req.on('close', () => { clearInterval(ping); subscribers.delete(res); });
            return undefined;
        }
        const action = actions[`${req.method} ${rel}`];
        if (!action) return send(404, { error: 'not found' });
        try {
            send(200, await action(req.method === 'POST' ? await readBody(req) : {}));
        } catch (error) {
            send(error.status || 500, { error: String(error?.message || error) });
        }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    server.unref();
    const port = server.address().port;
    return {
        port,
        token,
        url: `http://127.0.0.1:${port}${PREFIX}/?token=${token}`,
        /** 应用状态变了(比如进入救援),让打开着的页面刷新。 */
        refresh: () => emit('refresh'),
        close: () => new Promise((resolve) => { for (const r of subscribers) r.end(); server.close(resolve); }),
    };
}
