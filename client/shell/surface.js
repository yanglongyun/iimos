// 桌面上的「界面」:形态的窗口。形态自己不碰 Electron,窗口由这里开。
// 主窗口(id 是 main)在形态报到时打开;形态还可以通过 window.open 能力开别的窗口。
import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

// macOS 留原生红绿灯;Windows/Linux 无框 —— 标题栏和默认菜单那排没用,
// 拖拽、双击最大化靠形态顶栏的拖拽区,三个窗口钮由形态画在顶栏里,经 preload.cjs 回到这里(#3)
const APP_FRAME = process.platform === 'darwin' ? {} : { frame: false };
const PRELOAD = path.join(import.meta.dirname, 'preload.cjs');

const WINDOW = {
    width: 980,
    height: 760,
    minWidth: 520,
    minHeight: 480,
    title: 'morphic',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // 和出厂界面的 --bg 一致,开窗时不闪一下
    backgroundColor: '#050505',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
};

/** 外链交给系统浏览器,窗口只停在 allowed 这个源上。 */
function guard(win, allowed) {
    win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(allowed)) { event.preventDefault(); void shell.openExternal(url); }
    });
}

/** 形态给的窗口偏好,只认这几项、只认合理的值。 */
function windowOptions(prefs = {}) {
    const out = { ...WINDOW, ...APP_FRAME, webPreferences: { ...WINDOW.webPreferences, preload: PRELOAD } };
    const num = (v, min, max) => (Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined);
    const size = { width: num(prefs.width, 320, 4000), height: num(prefs.height, 240, 3000), minWidth: num(prefs.minWidth, 200, 2000), minHeight: num(prefs.minHeight, 200, 2000) };
    for (const [k, v] of Object.entries(size)) if (v !== undefined) out[k] = v;
    if (typeof prefs.title === 'string' && prefs.title) out.title = prefs.title.slice(0, 60);
    if (typeof prefs.background === 'string' && /^#[0-9a-f]{6}$/i.test(prefs.background)) out.backgroundColor = prefs.background;
    return out;
}

function load(win, url) {
    return new Promise((resolve, reject) => {
        win.webContents.once('did-finish-load', () => {
            // 窗口拿到前台、页面拿到焦点,提示符才有光标(重启后 macOS 不一定把新窗口放到前面)
            win.focus();
            win.webContents.focus();
            resolve();
        });
        win.webContents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
            // -3 是被新的导航打断,不算失败
            if (isMainFrame && code !== -3) reject(new Error(`界面加载失败:${description}(${code})`));
        });
        void win.loadURL(url).catch(() => { /* did-fail-load 会报 */ });
    });
}

/** onClosed(id) 在任一窗口关闭时调用,launcher 把它作为 window.closed 事件发给形态。 */
export function createSurfaces({ log, onClosed = () => {} }) {
    let appUrl = null;
    let prefs = {};
    const windows = new Map();   // id → BrowserWindow
    let seq = 0;

    function track(id, win) {
        windows.set(id, win);
        win.on('closed', () => { if (windows.get(id) === win) { windows.delete(id); onClosed(id); } });
    }
    const alive = (id) => { const win = windows.get(id); return win && !win.isDestroyed() ? win : null; };

    async function openMain(url) {
        const win = new BrowserWindow(windowOptions(prefs));
        guard(win, `${new URL(url).origin}/`);
        track('main', win);
        await load(win, url);
    }

    return {
        /** 打开形态的主窗口,真的加载出来才 resolve。 */
        open(url, window = {}) { appUrl = url; prefs = window || {}; return openMain(url); },
        /** 点 Dock 图标、菜单栏「打开」、再开一次 App:主窗口在就拿到前面,没有就重开。 */
        show() {
            const main = alive('main');
            if (main) { if (main.isMinimized()) main.restore(); main.show(); main.focus(); return; }
            if (appUrl) void openMain(appUrl).catch((error) => log('重开窗口失败', error));
        },
        reload() {
            for (const win of windows.values()) if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
        },
        /** 形态开的额外窗口:{ url, width, height, minWidth, minHeight, title, background }。返回 id。 */
        async openWindow({ url, ...window } = {}) {
            if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('url 必须是 http 或 https 地址');
            const id = `w${++seq}`;
            const win = new BrowserWindow(windowOptions(window));
            guard(win, `${new URL(url).origin}/`);
            track(id, win);
            await load(win, url);
            return id;
        },
        closeWindow(id) {
            const win = alive(id);
            if (!win) throw new Error(`没有这个窗口:${id}`);
            win.close();
        },
        focusWindow(id) {
            const win = alive(id);
            if (!win) throw new Error(`没有这个窗口:${id}`);
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        },
        listWindows() {
            return [...windows.entries()].filter(([, win]) => !win.isDestroyed()).map(([id, win]) => ({ id, title: win.getTitle(), url: win.webContents.getURL() }));
        },
        main: () => alive('main'),
    };
}
