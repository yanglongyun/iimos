// launcher 的核心:一次启动的全过程。纯 Node,不 import Electron;窗口这些交给宿主(shell)。
//
//   1. 找到应用(workspace),第一次就从出厂 seed 播一份,装了新版就尝试升级
//   2. 记账:启动前快照,连续起不来就回滚到 good
//   3. 加载应用入口(workspace/main.js),等它报到 iimos.ready({ url })
//   4. 留一扇不经过应用的门:救援页
//
// 跟环境有关的事交给宿主(host),见 docs/ARCHITECTURE.md「启动:core 与宿主」:
//   host.kind                 'desktop'
//   host.whenReady()          宿主准备好了(Electron 的 app.whenReady)
//   host.openSurface(url, w)  打开应用界面(w 是窗口偏好),界面真的加载出来才 resolve
//   host.reloadSurfaces()     重载应用界面
//   host.relaunch()           整个进程重启
//   host.showRecovery(url)    给用户看救援页
//   host.openFolder?(dir)     在访达里打开目录
//   host.capture?()           截应用界面(分享形态时做封面),返回 PNG Buffer
//
// 应用里的一切都可以被改。core 不 import 应用的任何模块,应用通过 globalThis.iimos 和它说话。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as guardian from './guardian.js';
import * as seed from './seed.js';
import { writeShims } from './shims.js';
import { startControl } from './control.js';
import { startRecovery } from './recovery/server.js';
import { createHandsHub } from './hands-hub.js';

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
 * 返回 { launcher(给应用的那个对象), start(), shutdown({ restarting }) , hub }
 */
export function createLauncher({ host, paths, seedDir, version, contract, toolchain, execPath, cliPath, log }) {
    let readyTimer = null;
    let promoteTimer = null;
    let state = 'starting';   // starting → running → opening → ready | failed | recovery
    let lastError = null;
    let appUrl = null;
    let recovery = null;
    const shutdownHooks = [];

    const hub = createHandsHub({ log });

    /** 应用看得到的 launcher。应用可以不用它,但 ready() 不调就会被当成没起来。 */
    const launcher = {
        version,
        host: host.kind,
        workspace: paths.workspace,
        data: paths.data,
        seed: seedDir,
        bin: paths.bin,
        contract,
        /** 手:电脑操作、浏览器、通知。 */
        hands: hub.api,
        /**
         * 应用起来了。传 { url, window? }:launcher 让宿主打开这个界面,真的加载出来才算报到成功。
         * window 是给桌面窗口的偏好:{ width, height, minWidth, minHeight, title, background }。
         * 不传(老版本应用自己开了窗口):直接算报到。
         */
        ready(info) {
            if (state !== 'running') return;
            if (info?.url) {
                appUrl = info.url;
                state = 'opening';
                Promise.resolve(host.openSurface(info.url, info.window || {}))
                    .then(() => markReady())
                    .catch((error) => void fail(error));
                return;
            }
            markReady();
        },
        /** 应用自己知道起不来了。 */
        failed(error) { void fail(error); },
        restart: () => restart(),
        reload: () => host.reloadSurfaces(),
        recovery: () => showRecovery(),
        /** 截应用界面,没有界面的宿主返回 null。 */
        capture: () => (host.capture ? host.capture() : null),
        /** 应用注册的收尾动作,launcher 重启或退出前依次调用,参数 { restarting }。 */
        onShutdown(fn) { shutdownHooks.push(fn); },
    };

    function markReady() {
        if (state !== 'running' && state !== 'opening') return;
        state = 'ready';
        clearTimeout(readyTimer);
        guardian.markReady({ ledgerFile: paths.ledger });
        log('应用已报到');
        recovery?.refresh();
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
        await hub.stop();
    }

    let restarting = false;
    async function restart() {
        if (restarting) return;
        restarting = true;
        log('重启');
        await shutdown({ restarting: true });
        // 不带 --recovery 重启:从救援页点「重启应用」,是想回到正常的应用里
        delete process.env.IIMOS_RECOVERY;
        await host.relaunch();
    }

    async function fail(error) {
        if (state === 'failed' || state === 'recovery') return;
        clearTimeout(readyTimer);
        clearTimeout(promoteTimer);
        lastError = error;
        log('应用没起来:', error);
        // 已经报到过的应用后来出的错不算「起不来」—— 交给救援,不回滚
        if (state === 'ready') { showRecovery(); return; }
        state = 'failed';
        guardian.markFailed({ ledgerFile: paths.ledger }, error);
        if (await guardian.willRecover({ workspace: paths.workspace, ledgerFile: paths.ledger })) {
            await restart();
        } else {
            log('同一版本连续起不来,且没有更早的稳定版本可回,进入救援');
            showRecovery();
        }
    }

    function showRecovery(reason) {
        if (state !== 'ready') state = 'recovery';
        if (reason) lastError = reason;
        recovery?.refresh();
        if (recovery) return host.showRecovery(recovery.url);
        return undefined;
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

    /** 应用入口:新的是 workspace/main.js(纯 Node);老版本的 desktop/main.js 只有桌面宿主还能加载。 */
    function entryFile() {
        const main = path.join(paths.workspace, 'main.js');
        if (fs.existsSync(main)) return main;
        const legacy = path.join(paths.workspace, 'desktop', 'main.js');
        if (host.kind === 'desktop' && fs.existsSync(legacy)) return legacy;
        return main;
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
            IIMOS_HOST: host.kind,
        };
        writeShims({ binDir: paths.bin, execPath, cliPath, env });
        // 应用和它的子进程(agent 的 bash)都继承这些
        Object.assign(process.env, env);

        await startControl({
            file: paths.control,
            routes: {
                'POST /restart': () => { setTimeout(restart, 300); return { ok: true, message: '马上重启' }; },
                'POST /reload': () => { host.reloadSurfaces(); return { ok: true, message: '窗口已重载' }; },
                'POST /recovery': () => { void showRecovery('从命令行打开'); return { ok: true }; },
                'GET /status': () => ({ ok: true, state, version, host: host.kind, app: Boolean(appUrl) }),
                'POST /status': () => ({ ok: true, state, version, host: host.kind, app: Boolean(appUrl) }),
                'GET /hands': () => ({ ok: true, hands: hub.api.list() }),
                'POST /hands/call': async ({ tool, args }) => ({ ok: true, result: await hub.api.call(tool, args || {}) }),
                'POST /capture': async () => {
                    const png = await launcher.capture();
                    return { ok: true, png: png ? png.toString('base64') : null };
                },
            },
        });

        recovery = await startRecovery({
            paths, seedDir, version, log, contract,
            reason: () => (lastError ? String(lastError?.stack || lastError) : ''),
            restart,
            openFolder: host.openFolder ? () => host.openFolder(paths.workspace) : null,
        });

        try {
            await prepareWorkspace();
        } catch (error) {
            log('准备 workspace 失败', error);
            lastError = error;
            await host.whenReady();
            return showRecovery();
        }

        const forced = process.argv.includes('--recovery') || process.env.IIMOS_RECOVERY === '1';
        const decision = forced ? { action: 'recovery', reason: '按要求进入救援模式' }
            : await guardian.beginBoot({ workspace: paths.workspace, ledgerFile: paths.ledger });
        if (decision.rolledBack) log(`回滚:${decision.rolledBack.from?.slice(0, 8)} → ${decision.rolledBack.to.slice(0, 8)},原版本留在 ${decision.rolledBack.branch}`);

        await host.whenReady();
        if (decision.action === 'recovery') {
            log('进入救援模式:', decision.reason);
            lastError = decision.reason;
            return showRecovery();
        }

        globalThis.iimos = launcher;
        state = 'running';
        readyTimer = setTimeout(() => void fail(new Error(`应用 ${READY_TIMEOUT_MS / 1000} 秒内没有报到`)), READY_TIMEOUT_MS);
        readyTimer.unref?.();
        const entry = entryFile();
        log(`加载应用 ${decision.commit?.slice(0, 8)}:${entry}`);
        try {
            if (!fs.existsSync(entry)) throw new Error(`应用入口不存在:${entry}`);
            await import(pathToFileURL(entry).href);
        } catch (error) {
            await fail(error);
        }
        return undefined;
    }

    return {
        launcher,
        start,
        shutdown,
        hub,
        showRecovery: (reason) => showRecovery(reason),
        state: () => state,
        recoveryUrl: () => recovery?.url || null,
    };
}
