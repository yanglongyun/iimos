// 本机的手:把电脑操作、浏览器、系统通知包成一只「手」,挂到 launcher 的手的总线上。
//
//   桌面形态:shell 在启动时调 startLocalHands,手和大脑在同一个进程里。
//   大脑在服务器上:同一只手经中继连过去(hands/link.js),大脑那边看到的是一只远处的手。
//
// 用户的授权都存在 $IIMOS_DATA/hands.json:
//   computer: true/false   「允许它操作这台电脑」—— 只能由用户在菜单栏里打开
//   browser:  { tokenHash, origin }   插件配对的凭据(只存哈希)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createComputer } from './computer.js';
import { createBrowserHost } from './browser.js';

export function computerBinary({ root, packaged, resourcesPath }) {
    return packaged ? path.join(resourcesPath, 'runtime', 'iimos-computer') : path.join(root, 'hands', 'runtime', 'iimos-computer');
}

export async function startLocalHands({ paths, log, root, packaged, resourcesPath, notify: showNotification }) {
    const file = path.join(paths.data, 'hands.json');
    const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
    const write = (patch) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ ...read(), ...patch }, null, 2), { mode: 0o600 });
    };

    const computer = process.platform === 'darwin'
        ? createComputer({ binary: computerBinary({ root, packaged, resourcesPath }), enabled: () => read().computer === true, log })
        : null;
    const browser = await createBrowserHost({ store: { get: () => read().browser || null, set: (value) => write({ browser: value }) }, log });

    let notifier = showNotification;
    if (!notifier) {
        try {
            const { Notification } = await import('electron');
            notifier = ({ title, body }) => new Notification({ title, body }).show();
        } catch { notifier = null; }
    }

    const tools = ['browser', ...(notifier ? ['notify'] : []), ...(computer ? ['computer'] : [])];
    const hand = {
        id: 'local',
        name: os.hostname().replace(/\.local$/, ''),
        tools,
        async call(tool, args = {}) {
            if (tool === 'computer' && computer) return computer.call(args);
            if (tool === 'browser') return browser.call(args);
            if (tool === 'notify' && notifier) {
                notifier({ title: String(args.title || 'iimos'), body: String(args.body || '') });
                return { ok: true };
            }
            throw new Error(`这只手不会「${tool}」`);
        },
        stop: () => browser.close(),
    };

    return {
        hand,
        browser,
        computerEnabled: () => read().computer === true,
        setComputerEnabled(value) {
            write({ computer: Boolean(value) });
            if (!value) computer?.stop('用户收回了电脑操作的许可');
            log?.(value ? '用户允许了电脑操作' : '用户收回了电脑操作的许可');
        },
        /** 紧急停止:⌘⇧⎋ 或菜单栏。正在进行的电脑、浏览器操作立刻中断。 */
        stopAll(reason) {
            computer?.stop(`用户${reason ? `从${reason}` : ''}停下了所有操作`);
            browser.stop();
            log?.(`停下所有电脑操作(${reason || '未知'})`);
        },
    };
}
