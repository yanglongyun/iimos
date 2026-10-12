// 编译电脑操作的小程序:hands/computer/main.swift → hands/runtime/iimos-computer。只有 macOS 需要。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function buildComputer({ arch = process.arch } = {}) {
    if (process.platform !== 'darwin') return null;
    const source = path.join(import.meta.dirname, 'computer', 'main.swift');
    const output = path.join(import.meta.dirname, 'runtime', 'iimos-computer');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const target = `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`;
    const result = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-swift-version', '5', '-target', target, '-O', source, '-o', output], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`电脑操作的小程序编译失败(${result.status})`);
    return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const output = buildComputer();
    console.log(output ? `已编译 ${output}` : '不是 macOS,跳过');
}
