// launcher 的核心:一次启动的全过程。纯 Node,不 import Electron;窗口这些交给宿主(shell)。
//
//   1. 找到应用(workspace),第一次就从出厂 seed 播一份,装了新版就尝试升级
//   2. 记账:启动前快照,连续起不来就回滚到 good —— 这是唯一的兜底
//   3. 加载应用入口(workspace/main.js),等它报到 iimos.ready({ url })
//
// 跟环境有关的事交给宿主(host):
//   host.whenReady()          宿主准备好了(Electron 的 app.whenReady)
//   host.openSurface(url, w)  打开应用界面(w 是窗口偏好),界面真的加载出来才 resolve
//   host.reloadSurfaces()     重载应用界面
//   host.relaunch()           整个进程重启
//   host.fatal(message)       连稳定版本都起不来:告诉用户,没有别的办法了
//
// 应用里的一切都可以被改。core 不 import 应用的任何模块,应用通过 globalThis.iimos 和它说话。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as guardian from './guardian.js';
import * as seed from './seed.js';
import { writeShims } from './shims.js';
import { startControl } from './control.js';

const READY_TIMEOUT_MS = Number(process.env.IIMOS_READY_TIMEOUT_MS) || 120_000;

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
 * opts: { host, paths, seedDir, version, contract, toolchain, execPath, cliPath, log }
 * 返回 { launcher(给应用的那个对象), start(), shutdown({ restarting }) }
 */
export function createLauncher({ host, paths, seedDir, version, contract, toolchain, execPath, cliPath, log }) {
    let readyTimer = null;
    let promoteTimer = null;
    let state = 'starting';   // starting → running → opening → ready | failed
    const shutdownHooks = [];

    /** 应用看得到的 launcher。应用可以不用它,但 ready() 不调就会被当成没起来。 */
    const launcher = {
        version,
        workspace: paths.workspace,
        data: paths.data,
        seed: seedDir,
        bin: paths.bin,
        contract,
        /**
         * 应用起来了。传 { url, window? }:launcher 让宿主打开这个界面,真的加载出来才算报到成功。
         * window 是给桌面窗口的偏好:{ width, height, minWidth, minHeight, title, background }。
         */
        ready(info) {
            if (state !== 'running') return;
            if (!info?.url) { void fail(new Error('ready() 要带上界面地址 { url }')); return; }
            state = 'opening';
            Promise.resolve(host.openSurface(info.url, info.window || {}))
                .then(() => markReady())
                .catch((error) => void fail(error));
        },
        /** 应用自己知道起不来了。 */
        failed(error) { void fail(error); },
        restart: () => restart(),
        reload: () => host.reloadSurfaces(),
        /** 应用注册的收尾动作,launcher 重启或退出前依次调用,参数 { restarting }。 */
        onShutdown(fn) { shutdownHooks.push(fn); },
    };

    function markReady() {
        if (state !== 'running' && state !== 'opening') return;
        state = 'ready';
        clearTimeout(readyTimer);
        guardian.markReady({ ledgerFile: paths.ledger });
        log('应用已报到');
        promoteTimer = setTimeout(() => {
            void guardian.promote({ workspace: paths.workspace, ledgerFile: paths.ledger })
                .then((oid) => oid && log(`稳定运行,${oid.slice(0, 8)} 成为 good`));
        }, guardian.HEALTHY_MS);
        promoteTimer.unref?.();
    }

    async function shutdown({ restarting = false } = {}) {
        for (const fn of shutdownHooks.splice(0)) {
            try { await fn({ restarting }); } catch (error) { log('收尾出错', error); }
        }
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
        return host.fatal(`iimos 起不来了,也没有更早的稳定版本可以退回。\n\n${String(reason?.stack || reason || '').slice(0, 1500)}\n\n日志:${paths.log}`);
    }

    async function fail(error) {
        if (state === 'failed') return;
        clearTimeout(readyTimer);
        clearTimeout(promoteTimer);
        log('应用没起来:', error);
        // 已经报到过的应用后来出的错不算「起不来」:不回滚,只记日志
        if (state === 'ready') return;
        state = 'failed';
        guardian.markFailed({ ledgerFile: paths.ledger }, error);
        if (await guardian.willRecover({ workspace: paths.workspace, ledgerFile: paths.ledger })) await restart();
        else await giveUp(error);
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
            IIMOS_BIN: paths.bin,
            IIMOS_TOOLCHAIN: toolchain,
        };
        writeShims({ binDir: paths.bin, execPath, cliPath, env });
        // 应用和它的子进程(agent 的 shell)都继承这些
        Object.assign(process.env, env);

        await startControl({
            file: paths.control,
            routes: {
                'POST /restart': () => { setTimeout(restart, 300); return { ok: true, message: '马上重启' }; },
                'POST /reload': () => { host.reloadSurfaces(); return { ok: true, message: '窗口已重载' }; },
                'GET /status': () => ({ ok: true, state, version }),
                'POST /status': () => ({ ok: true, state, version }),
            },
        });

        try {
            await prepareWorkspace();
        } catch (error) {
            await host.whenReady();
            return giveUp(error);
        }

        const decision = await guardian.beginBoot({ workspace: paths.workspace, ledgerFile: paths.ledger });
        if (decision.rolledBack) log(`回滚:${decision.rolledBack.from?.slice(0, 8)} → ${decision.rolledBack.to.slice(0, 8)},原版本留在 ${decision.rolledBack.branch}`);

        await host.whenReady();
        if (decision.action === 'give-up') return giveUp(decision.reason);

        globalThis.iimos = launcher;
        state = 'running';
        readyTimer = setTimeout(() => void fail(new Error(`应用 ${READY_TIMEOUT_MS / 1000} 秒内没有报到`)), READY_TIMEOUT_MS);
        readyTimer.unref?.();
        const entry = path.join(paths.workspace, 'main.js');
        log(`加载应用 ${decision.commit?.slice(0, 8)}:${entry}`);
        try {
            if (!fs.existsSync(entry)) throw new Error(`应用入口不存在:${entry}`);
            await import(pathToFileURL(entry).href);
        } catch (error) {
            await fail(error);
        }
        return undefined;
    }

    return { launcher, start, shutdown, state: () => state };
}
