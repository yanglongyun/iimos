// 电脑操作:驱动 hands/computer/main.swift 编出来的小程序(iimos-computer),一行一个 JSON 请求/回复。
//
// 截屏、读界面(辅助功能树)、点击、键盘、滚动、拖拽、打开/切换应用。需要两项 macOS 授权:
// 辅助功能、屏幕录制 —— 授权绑在签过名的 iimos.app 上,由用户在系统设置里勾。
// 另外有一道 iimos 自己的开关「允许它操作这台电脑」,只能由用户在菜单栏里打开,模型开不了。
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** 模型说的 action → 小程序的方法名 */
const METHODS = {
    permissions: 'permissions', request_permission: 'requestPermission', apps: 'apps', displays: 'displays',
    open: 'open', focus: 'focus', state: 'state', screenshot: 'screenshot', click: 'click',
    ax_action: 'action', set_value: 'setValue', press: 'press', type: 'type', scroll: 'scroll', drag: 'drag',
};
export const COMPUTER_ACTIONS = Object.keys(METHODS);

export function createComputer({ binary, enabled, log }) {
    let helper = null;
    let seq = 0;
    const pending = new Map();

    function reset(error) {
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
        pending.clear();
        if (helper) { const child = helper; helper = null; child.kill('SIGTERM'); }
    }

    function start() {
        if (helper) return helper;
        if (process.platform !== 'darwin') throw new Error('电脑操作目前只支持 macOS');
        if (!fs.existsSync(binary)) throw new Error(`电脑操作的小程序还没编译:${binary}(开发时运行 npm run build:hands)`);
        const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        helper = child;
        child.stdin.on('error', (error) => { if (helper === child) reset(error); });
        child.stderr.on('data', (chunk) => log?.(`iimos-computer: ${String(chunk).trim()}`));
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        lines.on('line', (line) => {
            let message;
            try { message = JSON.parse(line); } catch { reset(new Error('电脑操作的小程序返回了无效数据')); return; }
            const entry = pending.get(message.id);
            if (!entry) return;
            pending.delete(message.id);
            clearTimeout(entry.timer);
            if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.result);
        });
        child.on('error', (error) => { if (helper === child) reset(error); });
        child.on('exit', () => { lines.close(); if (helper === child) { helper = null; reset(new Error('电脑操作的小程序退出了,请重新读取界面')); } });
        return child;
    }

    function request(method, args) {
        const child = start();
        const id = ++seq;
        const timeout = method === 'type' ? 60_000 : method === 'requestPermission' ? 120_000 : 15_000;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reset(new Error('电脑操作超时,请重新读取界面')), timeout);
            pending.set(id, { resolve, reject, timer });
            child.stdin.write(`${JSON.stringify({ id, method, args, foreground: enabled() })}\n`, (error) => { if (error && helper === child) reset(error); });
        });
    }

    return {
        async call({ action, ...args }) {
            const method = METHODS[action];
            if (!method) throw new Error(`不认识的 action:${action}(可用:${COMPUTER_ACTIONS.join(', ')})`);
            // 只读权限状态之外,一切都要用户先在菜单栏里允许
            if (!['permissions', 'request_permission'].includes(action) && !enabled()) {
                throw new Error('用户还没允许它操作这台电脑:请用户在菜单栏 iimos 图标里勾选「允许它操作这台电脑」。别想办法绕过。');
            }
            if (action === 'ax_action') { args.action = args.name; delete args.name; }
            return request(method, args);
        },
        stop: (reason) => reset(new Error(reason || '电脑操作已被用户停止')),
    };
}
