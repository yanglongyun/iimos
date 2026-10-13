// 编译电脑操作的小程序,输出到 hands/runtime/。两个平台同一份协议:一行一个 JSON 请求 / 回复。
//   macOS:  hands/computer/mac/main.swift → iimos-computer(xcrun swiftc)
//   Windows:hands/computer/win/Program.cs → iimos-computer.exe(系统自带的 .NET Framework 4 csc.exe,不用装 SDK)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function buildMac(arch) {
    const source = path.join(import.meta.dirname, 'computer', 'mac', 'main.swift');
    const output = path.join(import.meta.dirname, 'runtime', 'iimos-computer');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const target = `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`;
    const result = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-swift-version', '5', '-target', target, '-O', source, '-o', output], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`电脑操作的小程序编译失败(${result.status})`);
    return output;
}

function buildWin() {
    const framework = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
    const csc = path.join(framework, 'csc.exe');
    if (!fs.existsSync(csc)) throw new Error(`找不到 ${csc}(.NET Framework 4 是 Windows 10/11 自带的)`);
    const source = path.join(import.meta.dirname, 'computer', 'win', 'Program.cs');
    const output = path.join(import.meta.dirname, 'runtime', 'iimos-computer.exe');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const refs = ['System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll', 'UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll'];
    const args = ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/lib:${path.join(framework, 'WPF')}`,
        ...refs.map((r) => `/reference:${r}`), `/out:${output}`, source];
    const result = spawnSync(csc, args, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`电脑操作的小程序编译失败(${result.status})`);
    return output;
}

export function buildComputer({ arch = process.arch } = {}) {
    if (process.platform === 'darwin') return buildMac(arch);
    if (process.platform === 'win32') return buildWin();
    return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const output = buildComputer();
    console.log(output ? `已编译 ${output}` : '这个平台没有电脑操作,跳过');
}
