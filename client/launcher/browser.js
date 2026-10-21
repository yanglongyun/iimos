// 浏览器能力:浏览器插件经原生消息宿主(native-host.js)连到这个本机管道,launcher 把形态的命令转给插件。
//
//   形态 ── morphic.call('browser.request', { action, args }) ──▶ launcher ── 管道 ──▶ 宿主 ── stdio ──▶ 插件 ──▶ 网页
//
// 管道上每行一个 JSON:launcher 发 { id, action, args },插件回 { id, result } 或 { id, error }。
// 只有当前用户能连这个管道,所以不需要令牌。插件连上、断开时给形态发事件 browser.connected / browser.disconnected。
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';

const TIMEOUT_MS = 30_000;

/** 返回 { capabilities, close() }。emit(name, data) 用来给形态发事件。 */
export function startBrowser({ address, emit, log }) {
    const sockets = [];
    const pending = new Map();

    function receive(line) {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.result);
    }

    const server = net.createServer((socket) => {
        sockets.push(socket);
        // 管道不撑着进程:launcher 的寿命由宿主决定,测试里也不该因为它退不出
        socket.unref();
        socket.setEncoding('utf8');
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk;
            let index = buffer.indexOf('\n');
            while (index >= 0) {
                receive(buffer.slice(0, index));
                buffer = buffer.slice(index + 1);
                index = buffer.indexOf('\n');
            }
        });
        socket.on('close', () => {
            sockets.splice(sockets.indexOf(socket), 1);
            log('浏览器插件断开');
            emit('browser.disconnected', {});
        });
        socket.on('error', () => {});
        log('浏览器插件已连接');
        emit('browser.connected', {});
    });
    server.on('error', (error) => log('浏览器管道不可用:', error.message, address));
    // 上次异常退出可能留下 socket 文件,监听前先删掉
    if (!address.startsWith('\\\\')) fs.rmSync(address, { force: true });
    server.listen(address);
    server.unref();

    /** 发一条命令给最近连上的插件,等它回结果。 */
    function request({ action, args = {} }) {
        const socket = sockets.at(-1);
        if (!socket) return Promise.reject(new Error('浏览器插件未连接:请在 Chrome 或 Edge 里安装并启用 morphic 插件'));
        if (typeof action !== 'string' || !action) return Promise.reject(new Error('缺少 action'));
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('浏览器插件没有响应')); }, TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            socket.write(`${JSON.stringify({ id, action, args })}\n`);
        });
    }

    return {
        capabilities: {
            'browser.request': request,
            'browser.status': async () => ({ connected: sockets.length > 0 }),
        },
        close() {
            for (const socket of sockets) socket.destroy();
            server.close();
        },
    };
}
