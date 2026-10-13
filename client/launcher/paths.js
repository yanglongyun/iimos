// launcher 认得的所有路径。纯 Node,不碰 Electron —— CLI 和单测用同一份。
//
//   <base>/                     ~/Library/Application Support/ai.iimos.desktop
//   ├── workspace/              应用本身:一个 git 仓库,agent 想怎么改就怎么改
//   ├── launcher/               launcher 的账本与运行态,应用不该去写
//   │   ├── state.json          启动记账:good、本次启动、失败次数、最近一次回滚
//   │   ├── control.json        控制端口与令牌(iimos 命令用它叫 launcher 重启/重载)
//   │   ├── bin/                node / iimos 两个垫片,放进 agent 的 PATH
//   │   └── launcher.log
//   └── data/                   用户数据(对话、模型配置……),不进 git,回滚不动它
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const DIR_NAME = 'ai.iimos.desktop';

function platformRoot() {
    if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
    if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
}

/** IIMOS_HOME 用来开一个和日常数据完全分开的目录(开发、测试)。 */
export function baseDir() {
    return process.env.IIMOS_HOME ? resolve(process.env.IIMOS_HOME) : join(platformRoot(), DIR_NAME);
}

export function launcherPaths() {
    const base = baseDir();
    const state = join(base, 'launcher');
    return {
        base,
        workspace: process.env.IIMOS_WORKSPACE || join(base, 'workspace'),
        data: process.env.IIMOS_DATA || join(base, 'data'),
        state,
        ledger: join(state, 'state.json'),
        control: join(state, 'control.json'),
        bin: join(state, 'bin'),
        log: join(state, 'launcher.log'),
    };
}
