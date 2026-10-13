// 给 agent 的两条命令:`node` 和 `iimos`。
//
// 用户机器上多半没有 Node,但 Electron 自己就是一个 Node(ELECTRON_RUN_AS_NODE=1)。
// 垫片每次启动重写一遍:应用升级后 Electron 的路径会变。
import fs from 'node:fs';
import path from 'node:path';

const sh = (lines) => `#!/bin/sh\n${lines.join('\n')}\n`;
const q = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

export function writeShims({ binDir, execPath, cliPath, env }) {
    fs.mkdirSync(binDir, { recursive: true });
    const exports = Object.entries(env).map(([key, value]) => `export ${key}=${q(value)}`);
    const files = {
        node: sh(['ELECTRON_RUN_AS_NODE=1 exec ' + q(execPath) + ' "$@"']),
        iimos: sh([...exports, 'ELECTRON_RUN_AS_NODE=1 exec ' + q(execPath) + ' ' + q(cliPath) + ' "$@"']),
    };
    for (const [name, body] of Object.entries(files)) {
        const file = path.join(binDir, name);
        fs.writeFileSync(file, body);
        fs.chmodSync(file, 0o755);
    }
    if (process.platform === 'win32') {
        const set = Object.entries(env).map(([key, value]) => `set "${key}=${value}"`);
        fs.writeFileSync(path.join(binDir, 'node.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" %*\r\n`);
        fs.writeFileSync(path.join(binDir, 'iimos.cmd'), `@echo off\r\n${set.join('\r\n')}\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" "${cliPath}" %*\r\n`);
    }
}
