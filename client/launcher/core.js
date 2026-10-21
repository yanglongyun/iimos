// launcher 的核心:一次启动的全过程。纯 Node,不 import Electron;窗口这些交给宿主(shell)。
//
//   1. 找到形态(workspace),第一次就从出厂 seed 播一份,装了新版就尝试升级
//   2. 记账:启动前快照,连续起不来就回滚到 good —— 这是唯一的兜底
//   3. 把形态拉起成子进程(child.js 加载 workspace/main.js),等它报到 iimos.ready({ url })
//
// 形态跑在自己的进程里:它卡死、崩溃都拖不垮 launcher 和窗口;起不来由 launcher 记账回滚,
// 报到之后崩了由 launcher 重新拉起。形态通过 globalThis.iimos(child.js 装的)和 launcher 说话。
//
// 跟环境有关的事交给宿主(host):
//   host.whenReady()          宿主准备好了(Electron 的 app.whenReady)
//   host.openSurface(url, w)  打开形态界面(w 是窗口偏好),界面真的加载出来才 resolve
//   host.reloadSurfaces()     重载形态界面
//   host.relaunch()           整个进程重启
//   host.fatal(message)       连稳定版本都起不来:告诉用户,没有别的办法了
//
// 形态能叫 launcher 做的事(iimos.call(name, args)):launcher 自己的(restart / reload / browser.* / terminal.*)加上宿主给的 capabilities。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import * as guardian from './guardian.js';
import * as seed from './seed.js';
import { writeShims } from './shims.js';
import { startControl } from './control.js';
import { startBrowser } from './browser.js';
import { startTerminal } from './terminal.js';

/** 契约版本:CONTRACT.md 里的能力对应的版本号,launcher 加了新能力就升。形态在 package.json 的 iimos.contract 里写它需要的最低版本。 */
export const CONTRACT_VERSION = 2;
const READY_TIMEOUT_MS = Number(process.env.IIMOS_READY_TIMEOUT_MS) || 120_000;
const EXIT_TIMEOUT_MS = 5_000;
const CHILD = path.join(import.meta.dirname, 'child.js');

export function createLog(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const stream = fs.createWriteStream(file, { flags: 'a' });
    return (...parts) => {
        const line = `[launcher ${new Date().toISOString()}] ${parts.map((p) => (p instanceof Error ? p.stack : String(p))).join(' ')}`;
        console.log(line);
        stream.write(`${line}\n`);
    };
}

/**
 * opts: { host, paths, seedDir, version, contract, toolchain, execPath, cliPath, log, capabilities }
 * 返回 { start(), shutdown({ restarting }), state(), emit(name, data) }
 */
export function createLauncher({ host, paths, seedDir, version, contract, toolchain, execPath, cliPath, log, capabilities = {} }) {
    let readyTimer = null;
    let promoteTimer = null;
    let state = 'starting';   // starting → running → opening → ready | failed
    let child = null;
    let childExited = null;   // 子进程退出的 Promise
    let promoted = false;
    let closing = false;
    let browser = null;
    let terminal = null;

    /** launcher 自己的能力;宿主和能力层的放在 capabilities 里,同名时这里的优先。 */
    const builtin = {
        restart: async () => { setTimeout(restart, 300); return { ok: true, message: '马上重启' }; },
        reload: async () => { await host.reloadSurfaces(); return { ok: true, message: '窗口已重载' }; },
    };

    /** 推一个事件给形态(快捷键按下、窗口关闭……)。形态没在跑就丢掉。 */
    function emit(name, data) {
        if (child?.connected) child.send({ type: 'event', name, data });
    }

    /** launcher 的一项能力。形态经 IPC 调,宿主和测试也能直接调。 */
    function call(name, args = {}) {
        const fn = builtin[name] || browser?.capabilities[name] || terminal?.capabilities[name] || capabilities[name];
        if (!fn) return Promise.reject(new Error(`launcher 没有这个能力:${name}`));
        return Promise.resolve(fn(args));
    }

    async function handleCall(id, name, args) {
        let reply;
        try { reply = { type: 'result', id, value: await call(name, args || {}) }; }
        catch (error) { reply = { type: 'result', id, error: { message: String(error?.message || error), stack: error?.stack ? String(error.stack).slice(0, 4000) : undefined } }; }
        if (child?.connected) child.send(reply);
    }

    function onReady(info) {
        if (state !== 'running') return;
        if (!info?.url) { void fail(new Error('ready() 要带上界面地址 { url }')); return; }
        state = 'opening';
        Promise.resolve(host.openSurface(info.url, info.window || {}))
            .then(() => markReady())
            .catch((error) => void fail(error));
    }

    function markReady() {
        if (state !== 'running' && state !== 'opening') return;
        state = 'ready';
        clearTimeout(readyTimer);
        guardian.markReady({ ledgerFile: paths.ledger });
        log('形态已报到');
        promoteTimer = setTimeout(() => {
            void guardian.promote({ workspace: paths.workspace, ledgerFile: paths.ledger })
                .then((oid) => { if (oid) { promoted = true; log(`稳定运行,${oid.slice(0, 8)} 成为 good`); } });
        }, guardian.HEALTHY_MS);
        promoteTimer.unref?.();
    }

    /** 让形态进程收尾并退出;不肯退就杀。 */
    async function stopChild({ restarting }) {
        if (!child) return;
        const proc = child;
        if (proc.connected) proc.send({ type: 'shutdown', restarting });
        const killer = setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, EXIT_TIMEOUT_MS);
        await childExited;
        clearTimeout(killer);
    }

    async function shutdown({ restarting = false } = {}) {
        closing = true;
        clearTimeout(readyTimer);
        clearTimeout(promoteTimer);
        await stopChild({ restarting });
        // 形态开的终端跟着形态走:它退了,终端一个不留
        terminal?.close();
        browser?.close();
    }

    let restarting = false;
    async function restart() {
        if (restarting) return;
        restarting = true;
        log('重启');
        await shutdown({ restarting: true });
        await host.relaunch();
    }

    function giveUp(reason) {
        state = 'failed';
        log('起不来,也没有更早的稳定版本可回:', reason);
        return host.fatal(`iimos 起不来了。\n\n${String(reason?.stack || reason || '').slice(0, 1500)}\n\n日志:${paths.log}`);
    }

    async function fail(error) {
        if (state === 'failed' || closing) return;
        clearTimeout(readyTimer);
        clearTimeout(promoteTimer);
        log('形态没起来:', error);
        state = 'failed';
        guardian.markFailed({ ledgerFile: paths.ledger }, error);
        if (await guardian.willRecover({ workspace: paths.workspace, ledgerFile: paths.ledger })) await restart();
        else await giveUp(error);
    }

    /** 形态进程退出了。什么时候退的,决定怎么处理。 */
    async function onExit(code, signal) {
        const reason = new Error(`形态进程退出(${signal || code})`);
        if (closing) return;
        if (state !== 'ready') { await fail(reason); return; }
        // 报到过但还没稳定到成为 good:算这次启动失败,交给记账去决定要不要回滚
        if (!promoted) { state = 'running'; await fail(reason); return; }
        // 稳定版本自己崩了:不算起不来,拉起来就是
        log('形态崩了,重新拉起:', reason);
        await restart();
    }

    function spawnChild(entry, env) {
        const stdio = fs.openSync(paths.log, 'a');
        child = spawn(execPath, [CHILD, entry], {
            cwd: paths.workspace,
            env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['ignore', stdio, stdio, 'ipc'],
        });
        fs.closeSync(stdio);
        childExited = new Promise((resolve) => child.once('exit', resolve));
        child.on('message', (message) => {
            if (!message || typeof message !== 'object') return;
            if (message.type === 'ready') onReady(message.info);
            else if (message.type === 'failed') void fail(Object.assign(new Error(message.error?.message || '形态报告启动失败'), { stack: message.error?.stack }));
            else if (message.type === 'call') void handleCall(message.id, message.name, message.args);
        });
        child.on('error', (error) => void fail(error));
        child.on('exit', (code, signal) => void onExit(code, signal));
        log(`形态进程 ${child.pid} 已拉起`);
    }

    /** 形态要求的契约版本比 launcher 高,起不了:装的 iimos 太旧。 */
    function checkContract() {
        let required = 0;
        try { required = Number(JSON.parse(fs.readFileSync(path.join(paths.workspace, 'package.json'), 'utf8')).iimos?.contract) || 0; } catch { /* 没写就不要求 */ }
        if (required > CONTRACT_VERSION) throw new Error(`这个形态需要契约版本 ${required},当前 launcher 只到 ${CONTRACT_VERSION}:请升级 iimos`);
    }

    async function prepareWorkspace() {
        const ledger = guardian.readLedger(paths.ledger);
        const planted = await seed.plant({ seedDir, workspace: paths.workspace, version });
        if (planted) {
            log(`播种 v${version} → ${planted.slice(0, 8)}`);
        } else {
            const result = await seed.upgrade({ seedDir, workspace: paths.workspace, version, previous: ledger.seedVersion });
            if (result.kind !== 'none') log(`出厂版本 ${ledger.seedVersion} → ${version}:${result.kind === 'replaced' ? '已直接换上' : '形态改过,等 agent 合并'}`);
        }
        guardian.writeLedger(paths.ledger, { ...guardian.readLedger(paths.ledger), seedVersion: version });
    }

    async function start() {
        fs.mkdirSync(paths.state, { recursive: true });
        fs.mkdirSync(paths.data, { recursive: true });
        const env = {
            IIMOS_HOME: paths.base,
            IIMOS_WORKSPACE: paths.workspace,
            IIMOS_DATA: paths.data,
            IIMOS_SEED: seedDir,
            IIMOS_VERSION: version,
            IIMOS_CONTRACT: contract,
            IIMOS_CONTRACT_VERSION: String(CONTRACT_VERSION),
            IIMOS_BIN: paths.bin,
            IIMOS_TOOLCHAIN: toolchain,
        };
        writeShims({ binDir: paths.bin, execPath, cliPath, env });
        // iimos 命令和形态的子进程都要这些
        Object.assign(process.env, env);

        browser = startBrowser({ address: paths.browser, emit, log });
        terminal = startTerminal({ stateDir: paths.state, emit, log });

        await startControl({
            file: paths.control,
            routes: {
                'POST /restart': () => builtin.restart(),
                'POST /reload': () => builtin.reload(),
                'GET /status': () => ({ ok: true, state, version, pid: child?.pid || null }),
                'POST /status': () => ({ ok: true, state, version, pid: child?.pid || null }),
            },
        });

        try {
            await prepareWorkspace();
            checkContract();
        } catch (error) {
            await host.whenReady();
            return giveUp(error);
        }

        const decision = await guardian.beginBoot({ workspace: paths.workspace, ledgerFile: paths.ledger });
        if (decision.rolledBack) log(`回滚:${decision.rolledBack.from?.slice(0, 8)} → ${decision.rolledBack.to.slice(0, 8)},原版本留在 ${decision.rolledBack.branch}`);

        await host.whenReady();
        if (decision.action === 'give-up') return giveUp(decision.reason);

        state = 'running';
        readyTimer = setTimeout(() => void fail(new Error(`形态 ${READY_TIMEOUT_MS / 1000} 秒内没有报到`)), READY_TIMEOUT_MS);
        readyTimer.unref?.();
        const entry = path.join(paths.workspace, 'main.js');
        log(`加载形态 ${decision.commit?.slice(0, 8)}:${entry}`);
        if (!fs.existsSync(entry)) { await fail(new Error(`形态入口不存在:${entry}`)); return undefined; }
        spawnChild(entry, env);
        return undefined;
    }

    return { start, shutdown, state: () => state, emit, call };
}
