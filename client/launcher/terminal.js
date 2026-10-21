// 终端能力:给形态一个真正的伪终端(pty),不用原生模块。
//
//   形态 ── iimos.call('terminal.spawn' | 'terminal.write' | 'terminal.resize' | 'terminal.kill', …) ──▶ launcher ──▶ 子进程
//   launcher ── 事件 terminal.data { id, data } / terminal.exit { id, code, signal } ──▶ 形态
//
// 形态跑在 launcher 拉起的子进程里,装不了 node-pty 这类原生模块;launcher 自己也只带纯 JS 依赖。
// 所以伪终端借系统自带的工具:
//   - macOS / Linux 有 expect(macOS 随系统带,/usr/bin/expect):用一段 expect 脚本开 pty 跑 shell,
//     stdin/stdout 原样透传,改尺寸走 stdin 里的一段私有控制序列(APC:ESC _ iimos:resize:列:行 ESC \)。
//   - 没有 expect 但有 script:也能拿到 pty,只是不能改尺寸。
//   - 都没有(Windows):普通管道起 shell,没有 pty,TUI 程序不可用,但命令照常能跑。
// 返回的 pty 字段告诉形态拿到的是哪一种。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RESIZE = (cols, rows) => `\x1b_iimos:resize:${cols}:${rows}\x1b\\`;
const MAX_TERMINALS = 64;

// expect 脚本:argv = 列 行 命令 参数…。stty_init 是 expect 开 pty 时应用的初始尺寸;
// interact 把两边原样接起来,顺便认出改尺寸的控制序列,对 pty 的从端执行 stty。
// 两边的字节靠 UTF-8 locale 透传(LANG 不是 UTF-8 时 expect 会把输入按字节重编码,中文就坏了,所以 spawn 时补 LANG)。
export const EXPECT_SCRIPT = `set timeout -1
set cols [lindex $argv 0]
set rows [lindex $argv 1]
set stty_init "rows $rows columns $cols"
encoding system utf-8
fconfigure stdout -buffering none
eval spawn -noecho [lrange $argv 2 end]
set pty $spawn_out(slave,name)
interact {
  -input $user_spawn_id
  -re "\\x1b_iimos:resize:(\\[0-9]+):(\\[0-9]+)\\x1b\\\\\\\\" {
    catch { exec stty rows $interact_out(2,string) columns $interact_out(1,string) < $pty }
  }
  eof { exit 0 }
  -output $spawn_id
  -input $spawn_id
  eof { return }
  -output $user_spawn_id
}
set r [wait]
exit [lindex $r 3]
`;

const exists = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

/** 默认 shell:用户自己的,没有就按平台挑一个在的。 */
export function defaultShell(env = process.env, platform = process.platform) {
    const candidates = platform === 'win32'
        ? ['powershell.exe', env.COMSPEC, 'cmd.exe']
        : [env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'];
    return candidates.find((s) => s && (platform === 'win32' || exists(s))) || (platform === 'win32' ? 'cmd.exe' : '/bin/sh');
}

/** 怎么起 pty:expect 能改尺寸;script 只有 pty;都没有就普通管道。 */
export function ptyBackend(platform = process.platform) {
    if (platform === 'win32') return 'pipe';
    if (exists('/usr/bin/expect')) return 'expect';
    if (exists('/usr/bin/script')) return 'script';
    return 'pipe';
}

const num = (value, fallback, min, max) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** stateDir 放 expect 脚本。返回 { capabilities, close() }。emit(name, data) 给形态发事件。 */
export function startTerminal({ stateDir, emit, log = () => {} }) {
    const terminals = new Map();   // id → { proc, backend, cwd, shell }
    let seq = 0;
    const scriptFile = path.join(stateDir, 'pty.exp');

    function ensureScript() {
        fs.mkdirSync(stateDir, { recursive: true });
        if (!exists(scriptFile) || fs.readFileSync(scriptFile, 'utf8') !== EXPECT_SCRIPT) fs.writeFileSync(scriptFile, EXPECT_SCRIPT);
        return scriptFile;
    }

    function spawnTerminal({ shell, args = [], cwd, cols, rows, env = {} } = {}) {
        if (terminals.size >= MAX_TERMINALS) throw new Error(`终端太多了(最多 ${MAX_TERMINALS} 个)`);
        const platform = process.platform;
        const command = typeof shell === 'string' && shell ? shell : defaultShell();
        const argv = Array.isArray(args) ? args.map(String) : [];
        const dir = typeof cwd === 'string' && cwd ? cwd : process.env.HOME || process.cwd();
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`不是文件夹:${dir}`);
        const size = { cols: num(cols, 100, 2, 1000), rows: num(rows, 30, 1, 1000) };
        const extra = env && typeof env === 'object' ? Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string')) : {};
        const childEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...extra };
        delete childEnv.ELECTRON_RUN_AS_NODE;
        if (!/utf-?8/i.test(`${childEnv.LC_ALL || ''}${childEnv.LC_CTYPE || ''}${childEnv.LANG || ''}`)) childEnv.LANG = 'en_US.UTF-8';

        const backend = ptyBackend(platform);
        let file;
        let fileArgs;
        if (backend === 'expect') {
            file = '/usr/bin/expect';
            fileArgs = ['-f', ensureScript(), '--', String(size.cols), String(size.rows), command, ...argv];
        } else if (backend === 'script') {
            file = '/usr/bin/script';
            // macOS(BSD)的 script:script -q /dev/null 命令 参数…;Linux(util-linux):script -qfc "命令" /dev/null
            fileArgs = platform === 'darwin'
                ? ['-q', '/dev/null', command, ...argv]
                : ['-qfc', [command, ...argv].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' '), '/dev/null'];
        } else {
            file = command;
            fileArgs = argv;
        }

        const id = `t${++seq}`;
        const proc = spawn(file, fileArgs, { cwd: dir, env: childEnv, stdio: ['pipe', 'pipe', backend === 'pipe' ? 'pipe' : 'ignore'], windowsHide: true });
        const record = { proc, backend, cwd: dir, shell: command, cols: size.cols, rows: size.rows };
        terminals.set(id, record);
        const forward = (chunk) => emit('terminal.data', { id, data: chunk.toString('utf8') });
        proc.stdout.on('data', forward);
        proc.stderr?.on('data', forward);
        proc.stdin.on('error', () => {});
        proc.on('error', (error) => {
            log(`终端 ${id} 起不来:`, error.message);
            if (terminals.get(id) === record) {
                terminals.delete(id);
                emit('terminal.exit', { id, code: null, signal: null, error: error.message });
            }
        });
        proc.on('exit', (code, signal) => {
            if (terminals.get(id) !== record) return;
            terminals.delete(id);
            emit('terminal.exit', { id, code, signal });
        });
        log(`终端 ${id} 已拉起(${backend}):${command} @ ${dir}`);
        return { id, pid: proc.pid, pty: backend !== 'pipe', resizable: backend === 'expect', backend, shell: command, cwd: dir };
    }

    const get = (id) => {
        const record = terminals.get(String(id));
        if (!record) throw new Error(`没有这个终端:${id}`);
        return record;
    };

    const capabilities = {
        'terminal.spawn': async (args) => spawnTerminal(args),
        'terminal.write': async ({ id, data }) => {
            const { proc } = get(id);
            if (typeof data !== 'string') throw new Error('data 要是字符串');
            if (proc.stdin.writable) proc.stdin.write(data);
            return { ok: true };
        },
        'terminal.resize': async ({ id, cols, rows }) => {
            const record = get(id);
            record.cols = num(cols, record.cols, 2, 1000);
            record.rows = num(rows, record.rows, 1, 1000);
            if (record.backend !== 'expect') return { ok: false, reason: '这个终端不支持改尺寸' };
            if (record.proc.stdin.writable) record.proc.stdin.write(RESIZE(record.cols, record.rows));
            return { ok: true };
        },
        'terminal.kill': async ({ id, signal } = {}) => {
            const record = terminals.get(String(id));
            if (!record) return { ok: false, reason: '已经不在了' };
            kill(record, signal);
            return { ok: true };
        },
        'terminal.list': async () => ({
            terminals: [...terminals.entries()].map(([id, t]) => ({ id, pid: t.proc.pid, shell: t.shell, cwd: t.cwd, cols: t.cols, rows: t.rows, pty: t.backend !== 'pipe' })),
        }),
    };

    function kill(record, signal) {
        const { proc } = record;
        if (proc.exitCode !== null || proc.signalCode) return;
        // 先关输入:expect / shell 收到 EOF 会自己退;不退再杀
        try { proc.stdin.end(); } catch { /* 已经关了 */ }
        try { proc.kill(typeof signal === 'string' && signal ? signal : 'SIGTERM'); } catch { /* 已经退了 */ }
        const killer = setTimeout(() => { try { if (proc.exitCode === null) proc.kill('SIGKILL'); } catch { /* 已经退了 */ } }, 2000);
        killer.unref?.();
    }

    return {
        capabilities,
        /** launcher 退出或形态重启时:它开的终端一个不留。 */
        close() {
            for (const [id, record] of terminals) {
                terminals.delete(id);
                kill(record);
            }
        },
    };
}
