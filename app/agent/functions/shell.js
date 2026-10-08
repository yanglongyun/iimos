// 在 workspace 里执行终端命令。超时或被停下时连同子进程整组杀掉。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export default function shell(args, config, signal) {
    if (typeof args.command !== 'string' || !args.command) throw new Error('缺少 command 参数');
    if (args.workdir !== undefined && typeof args.workdir !== 'string') throw new Error('workdir 必须是字符串');
    signal?.throwIfAborted();
    // launcher 的 node / iimos 垫片放在 PATH 最前面;Electron 主进程的 ELECTRON_RUN_AS_NODE 不能漏给子进程
    const env = { ...process.env, PATH: `${config.bin ? `${config.bin}${path.delimiter}` : ''}${process.env.PATH || '/usr/bin:/bin'}` };
    delete env.ELECTRON_RUN_AS_NODE;
    return new Promise((resolve, reject) => {
        const child = spawn(existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', ['-c', args.command], {
            cwd: path.resolve(config.workdir, args.workdir || '.'),
            env,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let text = '';
        let truncated = false;
        let timedOut = false;
        let finished = false;
        let killTimer;
        const append = (data) => {
            const chunk = data.toString();
            const room = Math.max(0, config.max_output - text.length);
            text += chunk.slice(0, room);
            if (chunk.length > room) truncated = true;
        };
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        const kill = () => {
            if (!child.pid) return;
            try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
        };
        const stop = () => {
            kill();
            if (!killTimer) {
                killTimer = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(-1); }, 2000);
            }
        };
        const timer = setTimeout(() => { timedOut = true; stop(); }, config.timeout * 1000);
        const cleanup = () => {
            clearTimeout(timer);
            clearTimeout(killTimer);
            signal?.removeEventListener('abort', stop);
        };
        const finish = (code) => {
            if (finished) return;
            finished = true;
            cleanup();
            if (signal?.aborted) { reject(signal.reason); return; }
            resolve({
                failed: timedOut || code !== 0,
                text: `${text || '(无输出)'}${truncated ? '\n…(输出已截断)' : ''}${timedOut ? '\n[超时:命令已终止]' : ''}\n\n[退出码 ${code ?? -1}]`,
            });
        };
        signal?.addEventListener('abort', stop, { once: true });
        child.once('error', (error) => {
            if (finished) return;
            finished = true;
            cleanup();
            reject(error);
        });
        child.once('close', finish);
    });
}
