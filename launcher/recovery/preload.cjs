// 救援窗口的桥。只暴露救援要用的那几件事。
const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(`recovery:${name}`, ...args);

contextBridge.exposeInMainWorld('recovery', {
    status: call('status'),
    rollback: call('rollback'),
    factory: call('factory'),
    snapshot: call('snapshot'),
    restart: call('restart'),
    openFolder: call('open-folder'),
    chat: call('chat'),
    stop: call('stop'),
    resetChat: call('reset-chat'),
    onEvent: (fn) => ipcRenderer.on('recovery:event', (_event, payload) => fn(payload)),
});
