// 应用的入口,由 launcher 加载。起本地服务 → 报到 iimos.ready({ url })。
//
// 纯 Node,不碰 Electron:launcher 开窗口加载这个地址。窗口、菜单栏这些归 launcher 和壳管。
//
// 不经 launcher 也能跑(node main.js):那时没有快照和回滚,数据放 IIMOS_DATA 或 ./.data,地址打在终端里。
import path from 'node:path';

import { startServer } from './server/index.js';

const iimos = globalThis.iimos;
const workspace = iimos?.workspace || process.env.IIMOS_WORKSPACE || import.meta.dirname;
const data = iimos?.data || process.env.IIMOS_DATA || path.join(workspace, '.data');

const server = await startServer({ workspace, data, bin: iimos?.bin });
// 收尾:重启时告诉服务「这是重启」,正在跑的那一轮新进程起来后会接着跑
iimos?.onShutdown(({ restarting } = {}) => server.close({ restarting }));

// window 是给桌面窗口的偏好(大小、标题、开窗时的底色),换了风格时跟着改
if (iimos) iimos.ready({ url: server.url, window: { width: 980, height: 760, minWidth: 520, minHeight: 480, title: 'iimos', background: '#050505' } });
else console.log(server.url);
