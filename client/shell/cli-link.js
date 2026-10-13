// 让用户在自己的终端里也能用 `iimos`:把 launcher 写的垫片(launcher/bin/iimos)链接进一个在 PATH 里的目录。
// 垫片每次启动都会重写(带上当前的 Electron 路径和数据目录),链接指着它,所以装新版不用重链。
// 不要管理员权限:只挑当前用户写得进去的目录;别人的同名文件不覆盖。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = () => ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), 'bin')];

const writable = (dir) => { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } };

/** 现在链着的位置(指向 shim 的那个),没有就 null。 */
export function linkedAt(shim) {
    for (const dir of CANDIDATES()) {
        const file = path.join(dir, 'iimos');
        try { if (fs.readlinkSync(file) === shim) return file; } catch { /* 不是链接或不存在 */ }
    }
    return null;
}

export function linkCli(shim) {
    if (!fs.existsSync(shim)) throw new Error('iimos 命令还没生成,等应用起来再试');
    const existing = linkedAt(shim);
    if (existing) return { file: existing, already: true };
    for (const dir of CANDIDATES()) {
        if (!fs.existsSync(dir) || !writable(dir)) continue;
        const file = path.join(dir, 'iimos');
        if (fs.existsSync(file) || fs.lstatSync(file, { throwIfNoEntry: false })) continue;   // 别人的同名东西,不碰
        fs.symlinkSync(shim, file);
        return { file, already: false, inPath: (process.env.PATH || '').split(':').includes(dir) || dir.startsWith('/opt/homebrew') || dir === '/usr/local/bin' };
    }
    // 都写不进:建 ~/.local/bin,提示加 PATH
    const dir = path.join(os.homedir(), '.local', 'bin');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'iimos');
    if (!fs.lstatSync(file, { throwIfNoEntry: false })) fs.symlinkSync(shim, file);
    return { file, already: false, inPath: false };
}

export function unlinkCli(shim) {
    const file = linkedAt(shim);
    if (file) fs.rmSync(file);
    return file;
}
