// 应用的入口,由 launcher 加载。起本地服务 → 开窗口 → 页面加载完向 launcher 报到。
//
// 不经 launcher 也能跑(electron app/desktop/main.js):那时没有快照和回滚,数据放 IIMOS_DATA 或 userData。
import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

import { startServer } from '../server/index.js';

const launcher = globalThis.iimos;
const workspace = launcher?.workspace || process.env.IIMOS_WORKSPACE || path.resolve(import.meta.dirname, '..');
const data = launcher?.data || process.env.IIMOS_DATA || path.join(app.getPath('userData'), 'data');

await app.whenReady();
const server = await startServer({ workspace, data, bin: launcher?.bin });
// launcher 重启前的收尾:告诉服务这是重启,正在跑的那一轮新进程起来后会接着跑
launcher?.onShutdown(() => server.close({ restarting: true }));

let reported = false;

function openWindow() {
    const win = new BrowserWindow({
        width: 980,
        height: 760,
        minWidth: 520,
        minHeight: 480,
        title: 'iimos',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        // 和 ui/style.css 的 --bg 一致,开窗时不闪一下
        backgroundColor: '#050505',
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // 页面里的外链交给系统浏览器,不在应用窗口里跳走
    win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(`http://127.0.0.1:${server.port}/`)) { event.preventDefault(); void shell.openExternal(url); }
    });
    win.webContents.once('did-finish-load', () => {
        // 窗口拿到前台、页面拿到焦点,提示符才有光标(launcher 重启后,macOS 不一定把新窗口放到前面)
        win.focus();
        win.webContents.focus();
        if (!reported) { reported = true; launcher?.ready(); }
    });
    void win.loadURL(server.url);
    return win;
}

openWindow();
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) openWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { void server.close(); });
