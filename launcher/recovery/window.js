// 救援窗口。不加载应用的任何代码:应用改坏了,这里照样能开。
import { BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import * as snap from '../snapshot.js';
import * as seed from '../seed.js';
import { readLedger } from '../guardian.js';
import { runRescue, readCreds } from './agent.js';

let win = null;
let ctx = null;
let history = [];
let running = null;

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

function rescueInstructions() {
    let contract = '';
    try { contract = fs.readFileSync(path.join(import.meta.dirname, '..', 'CONTRACT.md'), 'utf8'); } catch { /* 没有就算了 */ }
    let agentDoc = '';
    try { agentDoc = fs.readFileSync(path.join(ctx.paths.workspace, 'AGENT.md'), 'utf8').slice(0, 20_000); } catch { /* 可能就是它坏了 */ }
    return [
        '你在 iimos 的救援窗口里。用户的应用可能被改坏了起不来,你的任务是帮用户把它修好。',
        '先看清楚:iimos status、iimos log、launcher 日志(下面有尾巴)、最近改了什么(iimos diff good)。',
        '修法有两种:直接改文件修好 bug;或者 iimos rollback <版本> 回到能用的版本。拿不准时先问用户。',
        '修完用 iimos snapshot 记一笔,然后告诉用户点「重启应用」。',
        `\n## 为什么进了救援\n${ctx.reason || '(未知)'}`,
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
        reason: ctx.reason,
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
        launcherLog: tail(ctx.paths.log),
    };
}

let wired = false;
function wire() {
    if (wired) return;
    wired = true;
    ipcMain.handle('recovery:status', () => status());
    ipcMain.handle('recovery:rollback', async (_e, ref) => {
        const ws = ctx.paths.workspace;
        const oid = await snap.resolve(ws, String(ref));
        if (!oid) throw new Error(`找不到版本:${ref}`);
        await snap.resetHard(ws, oid, { saveAs: `before-rollback-${stamp()}` });
        ctx.log(`救援窗口:回滚到 ${oid.slice(0, 8)}`);
        return status();
    });
    ipcMain.handle('recovery:factory', async () => {
        const saveAs = `before-factory-${stamp()}`;
        await seed.replace({
            seedDir: ctx.seedDir, workspace: ctx.paths.workspace, version: ctx.version,
            message: `恢复出厂 v${ctx.version}`, saveAs,
        });
        seed.clearPending(ctx.paths.workspace);
        ctx.log(`救援窗口:恢复出厂,原来的样子留在 ${saveAs}`);
        return status();
    });
    ipcMain.handle('recovery:snapshot', async (_e, message) => {
        const oid = await snap.commitAll(ctx.paths.workspace, String(message || '救援窗口快照'));
        return oid;
    });
    ipcMain.handle('recovery:restart', () => ctx.restart());
    ipcMain.handle('recovery:open-folder', () => shell.openPath(ctx.paths.workspace));
    ipcMain.handle('recovery:reset-chat', () => { running?.abort(); history = []; return true; });
    ipcMain.handle('recovery:stop', () => { running?.abort(); return true; });
    ipcMain.handle('recovery:chat', async (_e, text) => {
        if (running) throw new Error('上一句还没说完');
        running = new AbortController();
        const send = (type, data) => { if (win && !win.isDestroyed()) win.webContents.send('recovery:event', { type, data }); };
        const env = { ...process.env, PATH: `${ctx.paths.bin}${path.delimiter}${process.env.PATH || '/usr/bin:/bin'}` };
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            await runRescue({
                history, text: String(text || ''), workspace: ctx.paths.workspace, dataDir: ctx.paths.data, env,
                instructions: rescueInstructions(), signal: running.signal, emit: send,
            });
        } catch (error) {
            send('error', error?.name === 'AbortError' ? '已停止' : String(error?.message || error));
        } finally {
            running = null;
        }
        return true;
    });
}

export async function openRecovery(next) {
    ctx = { ...ctx, ...next };
    wire();
    if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
        win.webContents.send('recovery:event', { type: 'refresh' });
        return win;
    }
    win = new BrowserWindow({
        width: 1080,
        height: 720,
        minWidth: 760,
        minHeight: 520,
        title: 'iimos 救援',
        backgroundColor: '#14161a',
        webPreferences: {
            preload: path.join(import.meta.dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    win.__iimosRecovery = true;
    win.on('closed', () => { win = null; });
    await win.loadFile(path.join(import.meta.dirname, 'index.html'));
    return win;
}
