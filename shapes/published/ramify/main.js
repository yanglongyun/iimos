// 形态的入口,由 launcher 加载。起本地服务 → 报到 iimos.ready({ url, window })。
//
// 纯 Node,不碰 Electron:launcher 开窗口加载这个地址。窗口这类系统的事通过 globalThis.iimos 叫 launcher 做。
// 不经 launcher 也能跑(node main.js):那时没有快照和回滚,数据放 IIMOS_DATA 或 ./.data,地址打在终端里。
import path from 'node:path';

import { startServer } from './server/index.js';

const iimos = globalThis.iimos;
const workspace = iimos?.workspace || process.env.IIMOS_WORKSPACE || import.meta.dirname;
const data = iimos?.data || process.env.IIMOS_DATA || path.join(workspace, '.data');

const server = await startServer({ workspace, data, port: Number(process.env.PORT) || 0, bin: iimos?.bin });
iimos?.onShutdown(() => server.close());

if (iimos) {
    iimos.ready({
        url: server.url,
        window: {
            width: 1440,
            height: 900,
            minWidth: 900,
            minHeight: 600,
            title: 'ramify',
            background: '#f4f0ea',
            // 系统原生标题栏:界面不用给红绿灯让位
            titleBar: 'native',
        },
    });
} else {
    console.log(server.url);
    const shutdown = () => server.close().finally(() => process.exit(0));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
