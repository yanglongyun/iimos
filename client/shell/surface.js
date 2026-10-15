// 桌面上的「界面」:应用窗口。应用自己不再碰 Electron,窗口由这里开。
import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

// 应用窗口:macOS 留原生红绿灯;Windows/Linux 无框 —— 标题栏和默认菜单那排没用,
// 拖拽、双击最大化靠应用顶栏的拖拽区,三个窗口钮由应用画在顶栏里,经 preload.cjs 回到这里(#3)
const APP_FRAME = process.platform === 'darwin' ? {} : { frame: false };
const PRELOAD = path.join(import.meta.dirname, 'preload.cjs');

const WINDOW = {
    width: 980,
    height: 760,
    minWidth: 520,
    minHeight: 480,
    title: 'iimos',
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

export function createSurfaces({ log }) {
    let appUrl = null;
    let appWin = null;

    let prefs = {};
    /** 应用在 ready({ window }) 里给的偏好,只认这几项、只认合理的值。 */
    function windowOptions() {
        const out = { ...WINDOW, ...APP_FRAME, webPreferences: { ...WINDOW.webPreferences, preload: PRELOAD } };
        const num = (v, min, max) => (Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined);
        const size = { width: num(prefs.width, 320, 4000), height: num(prefs.height, 240, 3000), minWidth: num(prefs.minWidth, 200, 2000), minHeight: num(prefs.minHeight, 200, 2000) };
        for (const [k, v] of Object.entries(size)) if (v !== undefined) out[k] = v;
        if (typeof prefs.title === 'string' && prefs.title) out.title = prefs.title.slice(0, 60);
        if (typeof prefs.background === 'string' && /^#[0-9a-f]{6}$/i.test(prefs.background)) out.backgroundColor = prefs.background;
        return out;
    }

    function load(url) {
        const win = new BrowserWindow(windowOptions());
        guard(win, `${new URL(url).origin}/`);
        win.on('closed', () => { if (appWin === win) appWin = null; });
        appWin = win;
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

    return {
        /** 打开应用界面,真的加载出来才 resolve。 */
        open(url, window = {}) { appUrl = url; prefs = window || {}; return load(url); },
        /** 点 Dock 图标、菜单栏「打开」、再开一次 App:有窗口就拿到前面,没有就重开。 */
        show() {
            if (appWin && !appWin.isDestroyed()) { if (appWin.isMinimized()) appWin.restore(); appWin.show(); appWin.focus(); return; }
            if (appUrl) void load(appUrl).catch((error) => log('重开窗口失败', error));
        },
        reload() {
            if (appWin && !appWin.isDestroyed()) appWin.webContents.reloadIgnoringCache();
        },
        windows: () => [appWin].filter((w) => w && !w.isDestroyed()),
    };
}
