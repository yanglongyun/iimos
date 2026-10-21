// 无框窗口(Windows/Linux)的窗口钮:应用顶栏里那三个(最小化 / 最大化 / 关闭)。
// 沙箱 preload 只递这三个动作,页面依旧够不着 Node。macOS 用原生红绿灯,不注入 —— 应用据此决定画不画。
// 来自 @arkkwang 的 #3。
const { contextBridge, ipcRenderer } = require('electron');

if (process.platform !== 'darwin') {
    contextBridge.exposeInMainWorld('iimosWin', {
        minimize: () => ipcRenderer.send('win:minimize'),
        toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
        close: () => ipcRenderer.send('win:close'),
    });
}
