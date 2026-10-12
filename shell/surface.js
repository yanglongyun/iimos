// 桌面上的「界面」:应用窗口和救援窗口。应用自己不再碰 Electron,窗口由这里开。
import { BrowserWindow, shell } from 'electron';

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
    let recoveryWin = null;

    function load(url) {
        const win = new BrowserWindow(WINDOW);
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
        open(url) { appUrl = url; return load(url); },
        /** 点 Dock 图标、菜单栏「打开」、再开一次 App:有窗口就拿到前面,没有就重开。 */
        show() {
            if (appWin && !appWin.isDestroyed()) { if (appWin.isMinimized()) appWin.restore(); appWin.show(); appWin.focus(); return; }
            if (appUrl) void load(appUrl).catch((error) => log('重开窗口失败', error));
            else if (recoveryWin && !recoveryWin.isDestroyed()) recoveryWin.focus();
        },
        reload() {
            if (appWin && !appWin.isDestroyed()) appWin.webContents.reloadIgnoringCache();
        },
        openRecovery(url) {
            if (recoveryWin && !recoveryWin.isDestroyed()) {
                recoveryWin.show();
                recoveryWin.focus();
                return recoveryWin;
            }
            recoveryWin = new BrowserWindow({ ...WINDOW, width: 1080, height: 720, minWidth: 760, minHeight: 520, title: 'iimos 救援', backgroundColor: '#14161a' });
            guard(recoveryWin, `${new URL(url).origin}/`);
            recoveryWin.on('closed', () => { recoveryWin = null; });
            void recoveryWin.loadURL(url);
            return recoveryWin;
        },
        async capture() {
            if (!appWin || appWin.isDestroyed()) return null;
            return (await appWin.webContents.capturePage()).toPNG();
        },
        windows: () => [appWin, recoveryWin].filter((w) => w && !w.isDestroyed()),
    };
}
