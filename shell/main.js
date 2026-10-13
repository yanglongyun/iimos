// 桌面壳:Electron 主进程。只做宿主该做的事 —— 窗口、菜单栏、快捷键、开机自启、手 ——
// 其余交给 launcher/core.js(纯 Node,服务器形态用的也是它)。
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerSaveBlocker, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { launcherPaths } from '../launcher/paths.js';
import * as seed from '../launcher/seed.js';
import { createLauncher, createLog } from '../launcher/core.js';
import { createSurfaces } from './surface.js';
import { startLocalHands } from '../hands/index.js';
import { linkHands } from '../hands/link.js';
import { linkCli, linkedAt, unlinkCli } from './cli-link.js';

const RECOVERY_SHORTCUT = 'CommandOrControl+Alt+Shift+R';
const STOP_HANDS_SHORTCUT = 'CommandOrControl+Shift+Escape';

const paths = launcherPaths();
const dev = !app.isPackaged;
const root = path.resolve(import.meta.dirname, '..');
// 开发时(npm run app)仓库里的 app/ 就是 seed;打包后 seed 在 resources/seed
const seedDir = process.env.IIMOS_SEED || (dev ? path.join(root, 'app') : path.join(process.resourcesPath, 'seed'));
const version = seed.readSeedVersion(seedDir, app.getVersion());
// 界面编译工具链(esbuild、React):开发时就是仓库的 node_modules;打包后在 resources/toolchain(真实目录,不在 asar 里)
const toolchain = dev ? path.join(root, 'node_modules') : path.join(process.resourcesPath, 'toolchain', 'node_modules');

// 指定了 IIMOS_HOME(开发、测试)时,Electron 自己的 userData 也挪进去:不同的 IIMOS_HOME 才能同时开着
if (process.env.IIMOS_HOME) app.setPath('userData', path.join(paths.base, 'electron'));

/** 桌面偏好:开机自启、防休眠。存在 data 里,回滚不动它。 */
const prefsFile = path.join(paths.data, 'desktop.json');
const readPrefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { return {}; } };
const writePrefs = (next) => { fs.mkdirSync(paths.data, { recursive: true }); fs.writeFileSync(prefsFile, JSON.stringify({ ...readPrefs(), ...next }, null, 2)); };

let tray = null;
let awake = null;
let localHands = null;
let handsLink = null;

/** 借手给远处的 iimos:链接存在 data/hands-link.json,开机自动连。 */
const linkFile = path.join(paths.data, 'hands-link.json');
const readLink = () => { try { return JSON.parse(fs.readFileSync(linkFile, 'utf8')).link || null; } catch { return null; } };
function relinkHands(link, { save = true } = {}) {
    handsLink?.stop();
    handsLink = null;
    if (!link) { if (save) fs.rmSync(linkFile, { force: true }); return { linked: false }; }
    if (!localHands) throw new Error('这台电脑的手还没起来');
    // 链接不对会在这里抛出,不存坏链接
    handsLink = linkHands({ link, hand: localHands.hand, log: console.log });
    if (save) fs.writeFileSync(linkFile, JSON.stringify({ link }, null, 2), { mode: 0o600 });
    return { linked: true, instance: handsLink.instance };
}

function main() {
    // 单实例:第二次点图标,回到已经开着的那个
    if (!app.requestSingleInstanceLock()) { app.quit(); return; }
    fs.mkdirSync(paths.state, { recursive: true });
    const log = createLog(paths.log);
    const surfaces = createSurfaces({ log });

    const host = {
        kind: 'desktop',
        whenReady: () => app.whenReady(),
        openSurface: (url, window) => surfaces.open(url, window),
        reloadSurfaces: () => surfaces.reload(),
        relaunch: () => {
            app.relaunch({ args: process.argv.slice(1).filter((arg) => arg !== '--recovery') });
            // 正常退出走 before-quit 收尾;卡住了就强退
            setTimeout(() => app.exit(0), 5000).unref();
            quitting = true;
            app.quit();
        },
        showRecovery: (url) => surfaces.openRecovery(url),
        openFolder: (dir) => void shell.openPath(dir),
        capture: () => surfaces.capture(),
        /** 把这台电脑的手借给远处的 iimos;link 为空就断开。 */
        linkHands: (link) => relinkHands(link),
    };

    const core = createLauncher({
        host, paths, seedDir, version, toolchain, log,
        contract: path.join(root, 'launcher', 'CONTRACT.md'),
        execPath: process.execPath,
        cliPath: path.join(root, 'launcher', 'cli.js'),
    });

    let quitting = false;
    let closed = false;
    app.on('before-quit', (event) => {
        quitting = true;
        if (closed) return;
        event.preventDefault();
        void core.shutdown({ restarting: false }).finally(() => { closed = true; app.quit(); });
    });
    // 关掉窗口不退出:它还要醒着(定时任务、手机连进来)。退出走菜单栏或 ⌘Q
    app.on('window-all-closed', () => { if (quitting) app.quit(); });
    app.on('activate', () => surfaces.show());
    app.on('second-instance', () => surfaces.show());

    app.whenReady().then(async () => {
        try { globalShortcut.register(RECOVERY_SHORTCUT, () => void core.showRecovery('快捷键打开')); } catch { /* 被占用就算了 */ }
        if (dev && process.platform === 'darwin') app.dock?.setIcon(path.join(root, 'build', 'icon.png'));
        // Windows/Linux:默认菜单(File/Edit/View/Window)没用,无框窗口上也没处放,去掉;macOS 的菜单在屏幕顶上,
        // Cmd+C/V/Q 靠它,不动(#3)。窗口钮经 preload.cjs 发来这三个动作
        if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
        ipcMain.on('win:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
        ipcMain.on('win:toggle-maximize', (event) => {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
        });
        ipcMain.on('win:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());

        // 本机的手:电脑操作、浏览器、通知。挂到手的总线上,应用经 iimos.hands 调用
        const hands = await startLocalHands({ paths, log, root, packaged: !dev, resourcesPath: process.resourcesPath }).catch((error) => { log('本机的手没起来', error); return null; });
        if (hands) {
            core.hub.attach(hands.hand);
            localHands = hands;
            try { globalShortcut.register(STOP_HANDS_SHORTCUT, () => hands.stopAll('快捷键')); } catch { /* 被占用 */ }
            const saved = readLink();
            if (saved) relinkHands(saved, { save: false });
        }

        const prefs = readPrefs();
        if (prefs.keepAwake) awake = powerSaveBlocker.start('prevent-app-suspension');
        setupTray({ core, surfaces, hands });
    });
    app.on('will-quit', () => globalShortcut.unregisterAll());

    void core.start();
}

/**
 * 菜单栏图标。macOS 用模板图(黑 + 透明,系统按深浅色上色),1x 和 2x 都显式加进去:
 * 打包后图在 asar 里,createFromPath 不会自己去找 @2x,只拿 1x 放大,又粗又糊。别的平台用应用图标缩到 18px。
 */
function trayIcon() {
    const file = (name) => path.join(root, 'build', name);
    if (process.platform !== 'darwin') {
        const icon = nativeImage.createFromPath(file('icon.png'));
        return icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 18, height: 18 });
    }
    const icon = nativeImage.createEmpty();
    for (const [name, scaleFactor] of [['trayTemplate.png', 1], ['trayTemplate@2x.png', 2]]) {
        try { icon.addRepresentation({ scaleFactor, buffer: fs.readFileSync(file(name)) }); } catch { /* 缺一张就用另一张 */ }
    }
    icon.setTemplateImage(true);
    return icon;
}

function setupTray({ core, surfaces, hands }) {
    tray = new Tray(trayIcon());
    tray.setToolTip('iimos');
    const render = () => {
        const prefs = readPrefs();
        const login = app.getLoginItemSettings().openAtLogin;
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: '打开 iimos', click: () => surfaces.show() },
            { label: '救援', click: () => void core.showRecovery('从菜单栏打开') },
            { type: 'separator' },
            {
                label: '开机自动启动', type: 'checkbox', checked: login,
                click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }); render(); },
            },
            {
                label: '保持唤醒(定时任务准点跑)', type: 'checkbox', checked: Boolean(prefs.keepAwake),
                click: (item) => {
                    writePrefs({ keepAwake: item.checked });
                    if (item.checked && awake === null) awake = powerSaveBlocker.start('prevent-app-suspension');
                    if (!item.checked && awake !== null) { powerSaveBlocker.stop(awake); awake = null; }
                    render();
                },
            },
            ...(hands ? [
                {
                    label: '允许它操作这台电脑', type: 'checkbox', checked: hands.computerEnabled(),
                    click: (item) => { hands.setComputerEnabled(item.checked); render(); },
                },
                { label: '停下所有电脑操作  ⌘⇧⎋', click: () => hands.stopAll('菜单栏') },
            ] : []),
            { type: 'separator' },
            {
                label: '在终端里使用 iimos 命令', type: 'checkbox', checked: Boolean(linkedAt(path.join(paths.bin, 'iimos'))),
                click: (item) => {
                    const shim = path.join(paths.bin, 'iimos');
                    try {
                        if (!item.checked) { unlinkCli(shim); render(); return; }
                        const { file, inPath } = linkCli(shim);
                        void dialog.showMessageBox({
                            message: '终端里可以用 iimos 了',
                            detail: `链接在 ${file}。\n\n打开一个新的终端窗口试试:\niimos help\niimos adopt <形态 id>${inPath === false ? `\n\n这个目录可能不在你的 PATH 里,在 ~/.zshrc 加一行:\nexport PATH="${path.dirname(file)}:$PATH"` : ''}`,
                        });
                    } catch (error) {
                        void dialog.showMessageBox({ type: 'warning', message: '没装上', detail: error.message });
                    }
                    render();
                },
            },
            { type: 'separator' },
            { label: '退出 iimos', role: 'quit' },
        ]));
    };
    render();
    tray.on('click', () => { if (process.platform !== 'darwin') surfaces.show(); });
}

process.on('uncaughtException', (error) => console.error('未捕获异常', error));
process.on('unhandledRejection', (error) => console.error('未处理的 Promise 拒绝', error));

main();
