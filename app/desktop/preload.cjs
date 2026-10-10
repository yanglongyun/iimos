// 无框窗口的窗口钮:页面顶栏里那三个(最小化/最大化/关闭)。
// 沙箱 preload 里只递这三个动作,页面依旧够不着 Node。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('iimosWin', {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
});
