// iimos 的 launcher。安装包里唯一不变的部分。
//
// 只做四件事:
//   1. 找到应用(workspace),第一次就从出厂 seed 播一份,装了新版就尝试升级
//   2. 记账:启动前快照,连续起不来就回滚到 good
//   3. 把应用的 desktop/main.js 加载进来,等它报到
//   4. 留一扇不经过应用的门:救援窗口(⌘⌥⇧R、--recovery、或应用起不来时自动打开)
//
// 应用里的一切 —— 窗口、界面、服务、agent 本身 —— 都可以被改。
// launcher 不 import 应用的任何模块,应用通过 globalThis.iimos 和 launcher 说话。
import { app, BrowserWindow, globalShortcut } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { launcherPaths } from './paths.js';
import * as guardian from './guardian.js';
import * as seed from './seed.js';
import { writeShims } from './shims.js';
import { openRecovery } from './recovery/window.js';

const READY_TIMEOUT_MS = Number(process.env.IIMOS_READY_TIMEOUT_MS) || 120_000;
const RECOVERY_SHORTCUT = 'CommandOrControl+Alt+Shift+R';

const paths = launcherPaths();
// 开发时(npm run app)仓库里的 app/ 就是 seed;打包后 seed 在 resources/seed
const dev = !app.isPackaged;
const seedDir = process.env.IIMOS_SEED || (dev ? path.resolve(import.meta.dirname, '..', 'app') : path.join(process.resourcesPath, 'seed'));
const version = seed.readSeedVersion(seedDir, app.getVersion());
const contract = path.join(import.meta.dirname, 'CONTRACT.md');
// 界面编译工具链(esbuild、React):开发时就是仓库的 node_modules;打包后在 resources/toolchain(真实目录,不在 asar 里)
const toolchain = dev ? path.resolve(import.meta.dirname, '..', 'node_modules') : path.join(process.resourcesPath, 'toolchain', 'node_modules');

fs.mkdirSync(paths.state, { recursive: true });
fs.mkdirSync(paths.data, { recursive: true });
const logStream = fs.createWriteStream(paths.log, { flags: 'a' });
const log = (...parts) => {
    const line = `[launcher ${new Date().toISOString()}] ${parts.map((p) => (p instanceof Error ? p.stack : String(p))).join(' ')}`;
    console.log(line);
    logStream.write(`${line}\n`);
};

let readyTimer = null;
let promoteTimer = null;
let state = 'starting';   // starting → running → ready | failed | recovery
let lastError = null;

/** 应用看得到的 launcher。应用可以不用它,但 ready() 不调就会被当成没起来。 */
const launcher = {
    version,
    workspace: paths.workspace,
    data: paths.data,
    seed: seedDir,
    bin: paths.bin,
    contract,
    /** 应用起来了(窗口加载完、服务健康)。调一次就够。 */
    ready() {
        if (state !== 'running') return;
        state = 'ready';
        clearTimeout(readyTimer);
        guardian.markReady({ ledgerFile: paths.ledger });
        log('应用已报到');
        promoteTimer = setTimeout(() => {
            void guardian.promote({ workspace: paths.workspace, ledgerFile: paths.ledger })
                .then((oid) => oid && log(`稳定运行,${oid.slice(0, 8)} 成为 good`));
        }, guardian.HEALTHY_MS);
    },
    /** 应用自己知道起不来了。 */
    failed(error) { void fail(error); },
    restart: () => restart(),
    reload: () => reloadWindows(),
    recovery: () => showRecovery(),
    /** 应用注册的收尾动作(停服务之类),launcher 重启前会依次调用。 */
    onShutdown(fn) { shutdownHooks.push(fn); },
};
const shutdownHooks = [];

function reloadWindows() {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.__iimosRecovery) win.webContents.reloadIgnoringCache();
    }
}

let restarting = false;
async function restart() {
    if (restarting) return;
    restarting = true;
    log('重启');
    for (const fn of shutdownHooks) { try { await fn(); } catch (error) { log('收尾出错', error); } }
    // 不带 --recovery 重启:从救援窗口点「重启应用」,是想回到正常的应用里
    delete process.env.IIMOS_RECOVERY;
    app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== '--recovery') });
    // 正常退出让应用的 before-quit 收尾;卡住了就强退
    setTimeout(() => app.exit(0), 5000).unref();
    app.quit();
}

async function fail(error) {
    if (state === 'failed' || state === 'recovery') return;
    clearTimeout(readyTimer);
    clearTimeout(promoteTimer);
    lastError = error;
    log('应用没起来:', error);
    // 已经报到过的应用后来出的错不算「起不来」—— 交给救援窗口,不回滚
    if (state === 'ready') { showRecovery(); return; }
    state = 'failed';
    guardian.markFailed({ ledgerFile: paths.ledger }, error);
    if (await guardian.willRecover({ workspace: paths.workspace, ledgerFile: paths.ledger })) {
        await restart();
    } else {
        log('同一版本连续起不来,且没有更早的稳定版本可回,打开救援窗口');
        app.on('window-all-closed', () => app.quit());
        showRecovery();
    }
}

function showRecovery(reason) {
    if (state !== 'ready') state = 'recovery';
    return openRecovery({
        paths, seedDir, version, log,
        reason: reason || (lastError ? String(lastError?.stack || lastError) : ''),
        restart,
    });
}

function startControl() {
    const token = crypto.randomBytes(24).toString('hex');
    const routes = {
        '/restart': () => { setTimeout(restart, 300); return { ok: true, message: '马上重启' }; },
        '/reload': () => { reloadWindows(); return { ok: true, message: '窗口已重载' }; },
        '/recovery': () => { void showRecovery('从命令行打开'); return { ok: true }; },
        '/status': () => ({ ok: true, state, version }),
    };
    const server = http.createServer((req, res) => {
        const send = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
        if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
        const route = routes[new URL(req.url, 'http://x').pathname];
        if (!route) return send(404, { error: 'not found' });
        try { send(200, route()); } catch (error) { send(500, { error: String(error?.message || error) }); }
    });
    server.listen(0, '127.0.0.1', () => {
        fs.writeFileSync(paths.control, JSON.stringify({ port: server.address().port, token, pid: process.pid }), { mode: 0o600 });
    });
    server.unref();
}

async function prepareWorkspace() {
    const ledger = guardian.readLedger(paths.ledger);
    const planted = await seed.plant({ seedDir, workspace: paths.workspace, version });
    if (planted) {
        log(`播种 v${version} → ${planted.slice(0, 8)}`);
    } else {
        const result = await seed.upgrade({ seedDir, workspace: paths.workspace, version, previous: ledger.seedVersion });
        if (result.kind !== 'none') log(`出厂版本 ${ledger.seedVersion} → ${version}:${result.kind === 'replaced' ? '已直接换上' : '应用改过,等 agent 合并'}`);
    }
    guardian.writeLedger(paths.ledger, { ...guardian.readLedger(paths.ledger), seedVersion: version });
}

// 指定了 IIMOS_HOME(开发、测试)时,Electron 自己的 userData 也挪进去:
// 单实例锁、窗口存储都跟着数据目录走,不同的 IIMOS_HOME 才能同时开着,互不干扰
if (process.env.IIMOS_HOME) app.setPath('userData', path.join(paths.base, 'electron'));

async function main() {
    // launcher 自己先占住单实例:应用起不来时,第二次点图标也该回到救援窗口,而不是再起一份
    if (!app.requestSingleInstanceLock()) { app.quit(); return; }

    const env = {
        IIMOS_HOME: paths.base,
        IIMOS_WORKSPACE: paths.workspace,
        IIMOS_DATA: paths.data,
        IIMOS_SEED: seedDir,
        IIMOS_VERSION: version,
        IIMOS_CONTRACT: contract,
        IIMOS_BIN: paths.bin,
        IIMOS_TOOLCHAIN: toolchain,
    };
    writeShims({ binDir: paths.bin, execPath: process.execPath, cliPath: path.join(import.meta.dirname, 'cli.js'), env });
    // 应用和它的子进程(agent 的 bash)都继承这些
    Object.assign(process.env, env);

    app.whenReady().then(() => {
        try { globalShortcut.register(RECOVERY_SHORTCUT, () => void showRecovery('快捷键打开')); } catch { /* 被占用就算了 */ }
    });
    app.on('will-quit', () => globalShortcut.unregisterAll());

    startControl();
    try {
        await prepareWorkspace();
    } catch (error) {
        log('准备 workspace 失败', error);
        lastError = error;
        await app.whenReady();
        app.on('window-all-closed', () => app.quit());
        return showRecovery();
    }

    const forced = process.argv.includes('--recovery') || process.env.IIMOS_RECOVERY === '1';
    const decision = forced ? { action: 'recovery', reason: '按要求进入救援模式' }
        : await guardian.beginBoot({ workspace: paths.workspace, ledgerFile: paths.ledger });
    if (decision.rolledBack) log(`回滚:${decision.rolledBack.from?.slice(0, 8)} → ${decision.rolledBack.to.slice(0, 8)},原版本留在 ${decision.rolledBack.branch}`);

    if (decision.action === 'recovery') {
        log('进入救援模式:', decision.reason);
        lastError = decision.reason;
        await app.whenReady();
        // 应用没加载,没人接管窗口生命周期 —— 关了救援窗口就是退出
        app.on('window-all-closed', () => app.quit());
        return showRecovery(decision.reason);
    }

    globalThis.iimos = launcher;
    state = 'running';
    readyTimer = setTimeout(() => void fail(new Error(`应用 ${READY_TIMEOUT_MS / 1000} 秒内没有报到`)), READY_TIMEOUT_MS);
    const entry = path.join(paths.workspace, 'desktop', 'main.js');
    log(`加载应用 ${decision.commit?.slice(0, 8)}:${entry}`);
    try {
        if (!fs.existsSync(entry)) throw new Error(`应用入口不存在:${entry}`);
        await import(pathToFileURL(entry).href);
    } catch (error) {
        await app.whenReady();
        await fail(error);
    }
}

process.on('uncaughtException', (error) => log('未捕获异常', error));
process.on('unhandledRejection', (error) => log('未处理的 Promise 拒绝', error));

void main();
