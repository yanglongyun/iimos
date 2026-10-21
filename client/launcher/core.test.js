// launcher 核心的进程模型:形态跑在子进程里,报到、起不来、崩了、收尾,都由 launcher 处理。
// 宿主是假的(不开窗口),形态是临时目录里几行 main.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLauncher, CONTRACT_VERSION } from './core.js';
import { readLedger } from './guardian.js';

const CLI = path.join(import.meta.dirname, 'cli.js');
const CONTRACT = path.join(import.meta.dirname, 'CONTRACT.md');

function seedWith(mainJs, pkg = { version: '1.0.0' }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(dir, 'main.js'), mainJs);
    return dir;
}

function setup(mainJs, capabilities = {}, pkg = undefined) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-core-'));
    const state = path.join(base, 'launcher');
    const paths = {
        base, state,
        workspace: path.join(base, 'workspace'),
        data: path.join(base, 'data'),
        ledger: path.join(state, 'state.json'),
        control: path.join(state, 'control.json'),
        bin: path.join(state, 'bin'),
        log: path.join(state, 'launcher.log'),
        browser: path.join(base, 'browser.sock'),
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
        host, paths, seedDir: seedWith(mainJs, pkg), version: '1.0.0', contract: CONTRACT, toolchain: '', capabilities,
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
        globalThis.iimos.onShutdown(({ restarting }) => fs.writeFileSync(process.env.IIMOS_DATA + '/bye', String(restarting)));
        const echo = await globalThis.iimos.call('echo', { hello: 'world' });
        globalThis.iimos.on('ping', (data) => fs.writeFileSync(process.env.IIMOS_DATA + '/ping', JSON.stringify(data)));
        globalThis.iimos.ready({ url: 'http://127.0.0.1:1/?echo=' + echo.hello, window: { title: 'test' } });
    `, { echo: async (args) => args });
    await core.start();
    await until(() => core.state() === 'ready');
    assert.deepEqual(calls, [['open', 'http://127.0.0.1:1/?echo=world', { title: 'test' }]]);
    assert.equal(readLedger(paths.ledger).boot.status, 'ready');
    // 形态跑在另一个进程里:launcher 这边没有 globalThis.iimos
    assert.equal(globalThis.iimos, undefined);

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
        globalThis.iimos.onShutdown(() => new Promise(() => {}));
        globalThis.iimos.ready({ url: 'http://127.0.0.1:1/' });
        setInterval(() => {}, 1000);
    `);
    await core.start();
    await until(() => core.state() === 'ready');
    const started = Date.now();
    await core.shutdown();
    assert.ok(Date.now() - started < 8000, '应在时限内被杀掉');
});

test('浏览器能力:插件经管道连上,形态的 browser.request 转给插件,断开后报未连接', async () => {
    const { core, paths } = setup(`
        const fs = await import('node:fs');
        globalThis.iimos.on('browser.connected', async () => {
            const result = await globalThis.iimos.call('browser.request', { action: 'open', args: { url: 'https://example.com/' } });
            fs.writeFileSync(process.env.IIMOS_DATA + '/result', JSON.stringify(result));
        });
        globalThis.iimos.on('browser.disconnected', async () => {
            try { await globalThis.iimos.call('browser.request', { action: 'tabs' }); }
            catch (error) { fs.writeFileSync(process.env.IIMOS_DATA + '/offline', error.message); }
        });
        globalThis.iimos.ready({ url: 'http://127.0.0.1:1/' });
    `);
    await core.start();
    await until(() => core.state() === 'ready');
    assert.deepEqual(await core.call('browser.status'), { connected: false });

    const net = await import('node:net');
    const socket = net.connect(paths.browser);
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
        for (const line of chunk.split('\n').filter(Boolean)) {
            const request = JSON.parse(line);
            socket.write(JSON.stringify({ id: request.id, result: { tab: 7, title: request.args.url } }) + '\n');
        }
    });
    await until(() => fs.existsSync(path.join(paths.data, 'result')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.data, 'result'), 'utf8')), { tab: 7, title: 'https://example.com/' });
    assert.deepEqual(await core.call('browser.status'), { connected: true });
    socket.destroy();
    await until(() => fs.existsSync(path.join(paths.data, 'offline')));
    assert.match(fs.readFileSync(path.join(paths.data, 'offline'), 'utf8'), /未连接/);
    await core.shutdown();
});

test('形态要求的契约版本比 launcher 高 → 不启动,提示升级', async () => {
    const { core, calls } = setup("globalThis.iimos.ready({ url: 'http://127.0.0.1:1/' });\n", {}, { version: '1.0.0', iimos: { contract: CONTRACT_VERSION + 1 } });
    await core.start();
    assert.equal(core.state(), 'failed');
    assert.match(calls.find((c) => c[0] === 'fatal')[1], /契约版本/);
});
