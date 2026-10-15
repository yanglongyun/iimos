// 应用的入口,由 launcher 加载。起本地服务 → 报到 morphic.ready({ url })。
//
// 纯 Node,不碰 Electron:launcher 开窗口加载这个地址。窗口、菜单栏这些归 launcher 和壳管。
//
// 不经 launcher 也能跑(node main.js):那时没有快照和回滚,数据放 MORPHIC_DATA 或 ./.data,地址打在终端里。
import path from 'node:path';

import { startServer } from './server/index.js';

const morphic = globalThis.morphic;
const workspace = morphic?.workspace || process.env.MORPHIC_WORKSPACE || import.meta.dirname;
const data = morphic?.data || process.env.MORPHIC_DATA || path.join(workspace, '.data');

const server = await startServer({ workspace, data, bin: morphic?.bin });
// 收尾:重启时告诉服务「这是重启」,正在跑的那一轮新进程起来后会接着跑
morphic?.onShutdown(({ restarting } = {}) => server.close({ restarting }));

// window 是给桌面窗口的偏好(大小、标题、开窗时的底色),换了风格时跟着改
if (morphic) morphic.ready({ url: server.url, window: { width: 980, height: 760, minWidth: 520, minHeight: 480, title: 'morphic', background: '#050505' } });
else console.log(server.url);
