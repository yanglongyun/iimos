// 调 electron-builder 出安装包。
//
// 存在的理由只有一个:**`CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder` 这种
// 前缀在 Windows 的 cmd 里不是「设个环境变量」,是一条不存在的命令。**
// 打包脚本得三个平台都能跑,而不是「mac 上能跑,别处报个看不懂的错」。
//
// 关签名发现只对 mac 有意义(本地出包不签名);Windows / Linux 上它就是个没人读的变量。
// 要出签名版走 release:mac,那条不经过这里。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'node_modules', 'electron-builder', 'cli.js');

// 直接跑 cli.js,不走 .bin 里那层壳:Windows 上那是 .cmd,
// 而 Node 20.12 起 spawn 不给跑 .cmd(除非 shell: true,那又得自己操心引号)
execFileSync(process.execPath, [CLI, ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});
