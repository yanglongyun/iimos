#!/usr/bin/env node
// 服务器形态:没有窗口,常驻跑在一台不关机的机器上,手机和电脑经中继连进来。
//
//   node launcher/serve.js          守护进程:拉起子进程;子进程以退出码 75 退出就重启它
//                                   (相当于桌面的 app.relaunch),崩了就退避后再拉
//   node launcher/serve.js --child  真正干活的那个:launcher core + 应用,宿主是「无头」
//
// 数据目录同桌面(IIMOS_HOME 可改);手机访问先 `iimos pair`。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launcherPaths } from './paths.js';
import * as seed from './seed.js';
import { createLauncher, createLog } from './core.js';

export const RESTART_CODE = 75;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function supervise() {
    let child = null;
    let stopping = false;
    let crashes = 0;
    const run = () => {
        child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
        const started = Date.now();
        child.on('exit', (code, signal) => {
            child = null;
            if (stopping) process.exit(0);
            if (code === RESTART_CODE) { crashes = 0; run(); return; }
            // 正常跑了一阵才崩的不算连续崩溃
            crashes = Date.now() - started > 60_000 ? 1 : crashes + 1;
            const wait = Math.min(1000 * 2 ** (crashes - 1), 30_000);
            console.error(`[iimos] 进程退出(${signal || code}),${wait / 1000} 秒后重新拉起`);
            setTimeout(run, wait);
        });
    };
    const stop = (signal) => { stopping = true; if (child) child.kill(signal); else process.exit(0); };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
    run();
}

async function work() {
    const paths = launcherPaths();
    fs.mkdirSync(paths.state, { recursive: true });
    const log = createLog(paths.log);
    const seedDir = process.env.IIMOS_SEED || path.join(root, 'app');
    const version = seed.readSeedVersion(seedDir, '0.0.0');

    const host = {
        kind: 'server',
        whenReady: async () => {},
        async openSurface(url) {
            const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
            if (!res.ok) throw new Error(`界面打不开:${res.status}`);
            log(`界面在 ${url.replace(/\?token=.*/, '')}(本机访问;手机用 iimos pair)`);
        },
        reloadSurfaces: () => {},
        relaunch: async () => process.exit(RESTART_CODE),
        showRecovery: (url) => log(`救援页:${url}`),
    };

    const core = createLauncher({
        host, paths, seedDir, version, log,
        contract: path.join(root, 'launcher', 'CONTRACT.md'),
        toolchain: process.env.IIMOS_TOOLCHAIN || path.join(root, 'node_modules'),
        execPath: process.execPath,
        cliPath: path.join(root, 'launcher', 'cli.js'),
    });
    let closing = false;
    const quit = () => {
        if (closing) return;
        closing = true;
        void core.shutdown({ restarting: false }).finally(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);
    process.on('uncaughtException', (error) => log('未捕获异常', error));
    process.on('unhandledRejection', (error) => log('未处理的 Promise 拒绝', error));
    await core.start();
    await firstPair(core, log);
}

/** 服务器没有窗口:一台设备都没配过时,直接在终端打出配对二维码,扫了就能打开界面、配模型。 */
async function firstPair(core, log) {
    if (process.env.IIMOS_NO_PAIR === '1') return;
    const status = core.remote.api.status();
    if (status.devices.some((d) => d.kind === 'device')) return;
    try {
        const { link } = await core.remote.api.pair({ name: '第一台设备' });
        let qr = '';
        try { const { default: QR } = await import('qrcode'); qr = await QR.toString(link, { type: 'terminal', small: true }); } catch { /* 没有 qrcode */ }
        console.log(`\n${qr}\n还没有设备连着这台 iimos。用手机扫上面的码,或者在任何浏览器打开:\n${link}\n(这个链接就是钥匙,别发给别人。之后再配别的设备:iimos pair)\n`);
    } catch (error) {
        log('自动配对失败(中继连不上?)', error);
    }
}

if (process.argv.includes('--child')) await work();
else supervise();
