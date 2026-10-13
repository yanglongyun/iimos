// 界面编译:ui/src(React + TSX)→ ui/dist。iimos reload / restart / build 都先走这里。
//
// 工具链(esbuild、React)由 launcher 带着,放在一个真实目录里(打包后是 resources/toolchain/node_modules,
// esbuild 的原生二进制没法在 asar 里跑);workspace 里没有 node_modules,import 'react' 靠 nodePaths 找到这里。
// 编译选项归应用:默认值在下面,workspace 里有 ui/build.config.mjs 就交给它改(导出一个函数,收默认值、返回新的)。
//
// 编译失败不动 ui/dist —— 窗口还是上一个能用的版本,错误原样交回给 agent 去修。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** 工具链目录:launcher 启动时写进 IIMOS_TOOLCHAIN;没有就用仓库自己的 node_modules(开发、测试)。 */
export function toolchainDir() {
    return process.env.IIMOS_TOOLCHAIN || path.resolve(import.meta.dirname, '..', 'node_modules');
}

/** iimos add 装进来的第三方库:ui/vendor/vendor.json 记着 包名 → 本地文件。 */
export function readVendor(ui) {
    try { return JSON.parse(fs.readFileSync(path.join(ui, 'vendor', 'vendor.json'), 'utf8')); } catch { return {}; }
}

export function defaultOptions(ui, toolchain) {
    // import 'dayjs' → ./vendor/dayjs.js(iimos add 装的,没有 npm 也能用)
    const alias = Object.fromEntries(Object.entries(readVendor(ui)).map(([name, { file }]) => [name, `./vendor/${file}`]));
    return {
        absWorkingDir: ui,
        entryPoints: ['src/main.tsx'],
        outdir: 'dist',
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'chrome130',
        jsx: 'automatic',
        minify: true,
        // 中文原样输出,不转成 \uXXXX:产物更小,agent 翻产物时也看得懂
        charset: 'utf8',
        sourcemap: false,
        // 产物要进 git(回滚瞬间可用),压小一点;React 用生产版
        define: { 'process.env.NODE_ENV': '"production"' },
        loader: { '.svg': 'file', '.png': 'file', '.woff2': 'file' },
        nodePaths: [toolchain],
        alias,
        logLevel: 'silent',
    };
}

/**
 * 编译 workspace 的界面。没有 ui/src(纯静态界面)就跳过。
 * 返回 { ok: true, skipped?, ms } 或 { ok: false, error }(error 是排好版的编译错误,给 agent 看)。
 */
export async function buildUI({ workspace, toolchain = toolchainDir() }) {
    const ui = path.join(workspace, 'ui');
    if (!fs.existsSync(path.join(ui, 'src'))) return { ok: true, skipped: true };
    const esbuild = createRequire(path.join(toolchain, 'noop.js'))('esbuild');
    let options = defaultOptions(ui, toolchain);
    const configFile = path.join(ui, 'build.config.mjs');
    if (fs.existsSync(configFile)) {
        // 带个时间戳:同一个进程里多次编译时拿到的是改过的配置
        const mod = await import(`${pathToFileURL(configFile).href}?t=${Date.now()}`);
        if (typeof mod.default === 'function') options = { ...options, ...mod.default(options) };
    }
    const started = Date.now();
    // 先编到临时目录,成功了再换进 dist:失败时 dist 原样不动
    const outdir = path.resolve(ui, options.outdir || 'dist');
    const staging = `${outdir}.next`;
    fs.rmSync(staging, { recursive: true, force: true });
    try {
        await esbuild.build({ ...options, outdir: staging });
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        const messages = error.errors?.length
            ? (await esbuild.formatMessages(error.errors, { kind: 'error', color: false })).join('\n')
            : String(error.message || error);
        return { ok: false, error: messages.trim() };
    }
    fs.rmSync(outdir, { recursive: true, force: true });
    fs.renameSync(staging, outdir);
    return { ok: true, ms: Date.now() - started };
}
