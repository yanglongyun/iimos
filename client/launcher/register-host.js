// 把原生消息宿主登记到本机的 Chromium 系浏览器,插件才能连上 launcher。每次启动都重写,安装位置变了也能跟上。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** 宿主的名字,和插件的固定 ID(由 extension/manifest.json 里的 key 决定)。插件里的 HOST 要和这里一致。 */
export const HOST = 'ai.iimos.morphic';
export const EXTENSION = 'ojhdfjkbofioiolffhgpjpojklabniie';

/** 浏览器只能直接启动一个可执行文件,所以写一个启动脚本:用 Electron 自带的 Node 跑 native-host.js。 */
function writeLauncher({ dir, execPath, script, env }) {
    if (process.platform === 'win32') {
        const file = path.join(dir, 'native-host.cmd');
        const set = Object.entries(env).map(([key, value]) => `set "${key}=${value}"`);
        fs.writeFileSync(file, `@echo off\r\n${set.join('\r\n')}\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" "${script}" %*\r\n`);
        return file;
    }
    const file = path.join(dir, 'native-host.sh');
    const q = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
    const exports = Object.entries(env).map(([key, value]) => `export ${key}=${q(value)}`);
    fs.writeFileSync(file, `#!/bin/sh\n${exports.join('\n')}\nELECTRON_RUN_AS_NODE=1 exec ${q(execPath)} ${q(script)} "$@"\n`);
    fs.chmodSync(file, 0o755);
    return file;
}

/**
 * dir:放启动脚本和登记文件的目录(launcher 的状态目录);env:宿主要带的环境变量(MORPHIC_HOME,找到正确的管道)。
 * 返回登记到了哪些浏览器。
 */
export function registerHost({ dir, execPath, script, env }) {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return [];
    fs.mkdirSync(dir, { recursive: true });
    const launcher = writeLauncher({ dir, execPath, script, env });
    const manifest = JSON.stringify({
        name: HOST,
        description: 'morphic 浏览器插件的原生消息宿主',
        path: launcher,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION}/`],
    }, null, 2);

    if (process.platform === 'win32') {
        // Windows 上浏览器从注册表找登记文件
        const file = path.join(dir, `${HOST}.json`);
        fs.writeFileSync(file, manifest);
        const done = [];
        for (const browser of ['Google\\Chrome', 'Microsoft\\Edge']) {
            const result = spawnSync('reg', ['add', `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${HOST}`, '/ve', '/t', 'REG_SZ', '/d', file, '/f'], { stdio: 'ignore', windowsHide: true });
            if (result.status === 0) done.push(browser);
        }
        return done;
    }

    // macOS 上每个浏览器有自己的登记目录;只给装了的浏览器写
    const support = path.join(os.homedir(), 'Library', 'Application Support');
    const done = [];
    for (const browser of ['Google/Chrome', 'Microsoft Edge', 'Chromium', 'BraveSoftware/Brave-Browser', 'Arc/User Data']) {
        const base = path.join(support, browser);
        if (!fs.existsSync(base)) continue;
        const directory = path.join(base, 'NativeMessagingHosts');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, `${HOST}.json`), manifest);
        done.push(browser);
    }
    return done;
}
