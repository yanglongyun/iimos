// 形态进程的入口。launcher 用 ELECTRON_RUN_AS_NODE 把它作为子进程拉起:`child.js <workspace/main.js>`。
//
// 它只做一件事:把 launcher 装成 globalThis.iimos,再加载形态的入口。形态和 launcher 之间走进程间通道(IPC):
//   形态 → launcher   { type: 'ready', info } · { type: 'failed', error } · { type: 'call', id, name, args }
//   launcher → 形态   { type: 'result', id, value | error } · { type: 'event', name, data } · { type: 'shutdown', restarting }
//
// 形态跑在自己的进程里:它卡死、崩溃、把内存吃光,launcher 和窗口都不受影响,launcher 负责把它拉起来。
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
const env = process.env;
const pending = new Map();
const listeners = new Map();
const shutdownHooks = [];
let seq = 0;

function send(message) {
    if (process.connected) process.send(message);
}

/** 叫 launcher 做一件事,等结果。能力有哪些见 CONTRACT.md「launcher 提供的能力」。 */
function call(name, args = {}) {
    if (!process.connected) return Promise.reject(new Error('launcher 已断开'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ type: 'call', id, name, args });
    });
}

const serializeError = (error) => ({ message: String(error?.message || error), stack: error?.stack ? String(error.stack).slice(0, 4000) : undefined });

const iimos = {
    version: env.IIMOS_VERSION,
    workspace: env.IIMOS_WORKSPACE,
    data: env.IIMOS_DATA,
    seed: env.IIMOS_SEED,
    bin: env.IIMOS_BIN,
    contract: env.IIMOS_CONTRACT,
    /** 形态起来了:{ url, window? }。launcher 开窗口加载 url,真的加载出来才算报到。 */
    ready(info) { send({ type: 'ready', info }); },
    /** 形态自己知道起不来了。 */
    failed(error) { send({ type: 'failed', error: serializeError(error) }); },
    restart: () => call('restart'),
    reload: () => call('reload'),
    /** 重启或退出前的收尾,fn({ restarting })。 */
    onShutdown(fn) { shutdownHooks.push(fn); },
    call,
    /** 订阅 launcher 发来的事件(快捷键按下、窗口关闭、浏览器插件连上……)。返回取消订阅的函数。 */
    on(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
        return () => listeners.get(name)?.delete(fn);
    },
};
globalThis.iimos = iimos;

async function shutdown({ restarting }) {
    for (const fn of shutdownHooks.splice(0)) {
        try { await fn({ restarting }); } catch (error) { console.error('收尾出错', error); }
    }
    process.exit(0);
}

process.on('message', (message) => {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
        case 'result': {
            const request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id);
            if (message.error) request.reject(Object.assign(new Error(message.error.message), { stack: message.error.stack }));
            else request.resolve(message.value);
            return;
        }
        case 'event':
            for (const fn of listeners.get(message.name) || []) {
                try { fn(message.data); } catch (error) { console.error(`处理事件 ${message.name} 出错`, error); }
            }
            return;
        case 'shutdown':
            void shutdown({ restarting: Boolean(message.restarting) });
            return;
        default:
    }
});
// launcher 没了(被杀、崩了),形态也没有存在的理由
process.on('disconnect', () => process.exit(0));
process.on('uncaughtException', (error) => { console.error('未捕获异常', error); iimos.failed(error); setTimeout(() => process.exit(1), 100); });
process.on('unhandledRejection', (error) => console.error('未处理的 Promise 拒绝', error));

if (!entry) { console.error('用法:child.js <入口文件>'); process.exit(2); }
try {
    await import(pathToFileURL(path.resolve(entry)).href);
} catch (error) {
    iimos.failed(error);
    console.error(error);
    setTimeout(() => process.exit(1), 100);
}
