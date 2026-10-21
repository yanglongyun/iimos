// launcher 核心的进程模型:形态跑在子进程里,报到、起不来、崩了、收尾,都由 launcher 处理。
// 宿主是假的(不开窗口),形态是临时目录里几行 main.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLauncher } from './core.js';
import { readLedger } from './guardian.js';

const CLI = path.join(import.meta.dirname, 'cli.js');
const CONTRACT = path.join(import.meta.dirname, 'CONTRACT.md');

function seedWith(mainJs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    fs.writeFileSync(path.join(dir, 'main.js'), mainJs);
    return dir;
}

function setup(mainJs, capabilities = {}) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'morphic-core-'));
    const state = path.join(base, 'launcher');
    const paths = {
        base, state,
        workspace: path.join(base, 'workspace'),
        data: path.join(base, 'data'),
        ledger: path.join(state, 'state.json'),
        control: path.join(state, 'control.json'),
        bin: path.join(state, 'bin'),
        log: path.join(state, 'launcher.log'),
    };
    const calls = [];
    const host = {
        whenReady: async () => {},
        openSurface: async (url, window) => { calls.push(['open', url, window]); },
        reloadSurfaces: async () => { calls.push(['reload']); },
        relaunch: async () => { calls.push(['relaunch']); },
        fatal: async (message) => { calls.push(['fatal', message]); },
    };
    const logs = [];
    const core = createLauncher({
        host, paths, seedDir: seedWith(mainJs), version: '1.0.0', contract: CONTRACT, toolchain: '', capabilities,
        execPath: process.execPath, cliPath: CLI, log: (...parts) => logs.push(parts.join(' ')),
    });
    return { core, paths, host, calls, logs };
}

const until = async (check, ms = 10_000) => {
    const deadline = Date.now() + ms;
    while (!check()) {
        if (Date.now() > deadline) throw new Error('等待超时');
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
};

test('形态在子进程里报到;收尾钩子在退出前被调用;launcher 的能力能被调用', async () => {
    const { core, paths, calls } = setup(`
        const fs = await import('node:fs');
        globalThis.morphic.onShutdown(({ restarting }) => fs.writeFileSync(process.env.MORPHIC_DATA + '/bye', String(restarting)));
        const echo = await globalThis.morphic.call('echo', { hello: 'world' });
        globalThis.morphic.on('ping', (data) => fs.writeFileSync(process.env.MORPHIC_DATA + '/ping', JSON.stringify(data)));
        globalThis.morphic.ready({ url: 'http://127.0.0.1:1/?echo=' + echo.hello, window: { title: 'test' } });
    `, { echo: async (args) => args });
    await core.start();
    await until(() => core.state() === 'ready');
    assert.deepEqual(calls, [['open', 'http://127.0.0.1:1/?echo=world', { title: 'test' }]]);
    assert.equal(readLedger(paths.ledger).boot.status, 'ready');
    // 形态跑在另一个进程里:launcher 这边没有 globalThis.morphic
    assert.equal(globalThis.morphic, undefined);

    core.emit('ping', { n: 1 });
    await until(() => fs.existsSync(path.join(paths.data, 'ping')));
    assert.equal(fs.readFileSync(path.join(paths.data, 'ping'), 'utf8'), '{"n":1}');

    await core.shutdown({ restarting: true });
    assert.equal(fs.readFileSync(path.join(paths.data, 'bye'), 'utf8'), 'true');
});

test('形态进程没报到就退出 → 记一次失败,重启再试', async () => {
    const { core, paths, calls } = setup('process.exit(3);\n');
    await core.start();
    await until(() => calls.some((c) => c[0] === 'relaunch'));
    assert.equal(core.state(), 'failed');
    assert.equal(readLedger(paths.ledger).boot.status, 'failed');
    assert.match(readLedger(paths.ledger).boot.error, /退出\(3\)/);
});

test('形态抛错 → 走 failed 通道,错误原样记进账本', async () => {
    const { core, paths, calls } = setup('throw new Error("启动就炸");\n');
    await core.start();
    await until(() => calls.some((c) => c[0] === 'relaunch'));
    assert.match(readLedger(paths.ledger).boot.error, /启动就炸/);
});

test('形态收尾时赖着不退 → 到时限被杀掉', async () => {
    const { core } = setup(`
        globalThis.morphic.onShutdown(() => new Promise(() => {}));
        globalThis.morphic.ready({ url: 'http://127.0.0.1:1/' });
        setInterval(() => {}, 1000);
    `);
    await core.start();
    await until(() => core.state() === 'ready');
    const started = Date.now();
    await core.shutdown();
    assert.ok(Date.now() - started < 8000, '应在时限内被杀掉');
});
