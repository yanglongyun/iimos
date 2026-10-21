// 原生消息宿主:在浏览器(stdio,带长度前缀)和 launcher 的管道(每行一个 JSON)之间双向转发。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { launcherPaths } from './paths.js';

const SCRIPT = path.join(import.meta.dirname, 'native-host.js');

function frame(value) {
    const body = Buffer.from(JSON.stringify(value));
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length);
    return Buffer.concat([head, body]);
}

test('宿主双向转发;浏览器关掉连接时退出', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-host-'));
    // 宿主按 IIMOS_HOME 算管道地址,这里用同一个算法
    process.env.IIMOS_HOME = home;
    const address = launcherPaths().browser;
    delete process.env.IIMOS_HOME;
    const lines = [];
    let pipe = null;
    const server = net.createServer((socket) => {
        pipe = socket;
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => lines.push(...chunk.split('\n').filter(Boolean)));
    });
    await new Promise((resolve) => server.listen(address, resolve));

    const host = spawn(process.execPath, [SCRIPT], { env: { ...process.env, IIMOS_HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
    // 浏览器 → launcher:一条消息分两次写,宿主按长度拼完整
    const message = frame({ id: '1', result: { title: '中文标题' } });
    host.stdin.write(message.subarray(0, 5));
    host.stdin.write(message.subarray(5));
    while (lines.length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(JSON.parse(lines[0]), { id: '1', result: { title: '中文标题' } });

    // launcher → 浏览器:每行一个 JSON,转成带长度的消息
    pipe.write(`${JSON.stringify({ id: '2', action: 'tabs', args: {} })}\n`);
    const [chunk] = await once(host.stdout, 'data');
    assert.deepEqual(JSON.parse(chunk.subarray(4, 4 + chunk.readUInt32LE(0)).toString()), { id: '2', action: 'tabs', args: {} });

    host.stdin.end();
    assert.equal((await once(host, 'exit'))[0], 0);
    server.close();
});

test('launcher 没在运行时宿主直接退出', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'iimos-host-'));
    const host = spawn(process.execPath, [SCRIPT], { env: { ...process.env, IIMOS_HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
    assert.equal((await once(host, 'exit'))[0], 1);
});
