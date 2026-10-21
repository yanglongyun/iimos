// iimos add <包>:用户机器上没有 npm,第三方前端库从 esm.sh 取。
//
// esm.sh 给的是一个「转一手」的小模块,真代码在它引用的其他 URL 上。这里用 esbuild + 一个 HTTP 插件,
// 把整棵引用树打成一个本地文件 ui/vendor/<名字>.js,来源和版本记进 ui/vendor/vendor.json。
// 之后编译界面时(build.js)按 vendor.json 自动加别名:代码里照常写 import dayjs from 'dayjs'。
//
// React 不打进去:留成外部 import,编译时用 launcher 带的那一份 —— 两份 React 会让 hooks 直接坏掉。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readVendor, toolchainDir } from './build.js';

const EXTERNAL = ['react', 'react-dom', 'react/*', 'react-dom/*'];

/** 'dayjs@1' → { name: 'dayjs', version: '1' };'@scope/pkg@2/sub' → { name: '@scope/pkg/sub', pkg: '@scope/pkg', version: '2', sub: '/sub' } */
export function parseSpec(spec) {
    const match = String(spec || '').trim().match(/^(@[^/@\s]+\/[^/@\s]+|[^/@\s]+)(?:@([^/\s]+))?(\/[^\s]*)?$/);
    if (!match) throw new Error(`看不懂的包名:${spec}`);
    const [, pkg, version = '', sub = ''] = match;
    return { pkg, version, sub, name: `${pkg}${sub}` };
}

/** 本地文件名:@scope/pkg/sub → scope__pkg__sub.js */
export const vendorFile = (name) => `${name.replace(/^@/, '').replace(/\//g, '__')}.js`;

/** 拉远程模块的 esbuild 插件:绝对 URL、/开头、./ 开头(在远程模块里)都按 URL 解析后下载。 */
function httpPlugin() {
    return {
        name: 'iimos-http',
        setup(build) {
            build.onResolve({ filter: /^https?:\/\// }, (args) => ({ path: args.path, namespace: 'http' }));
            build.onResolve({ filter: /^\.{0,2}\//, namespace: 'http' }, (args) => ({ path: new URL(args.path, args.importer).href, namespace: 'http' }));
            build.onLoad({ filter: /.*/, namespace: 'http' }, async (args) => {
                const res = await fetch(args.path);
                if (!res.ok) throw new Error(`下载失败 ${res.status}:${args.path}`);
                return { contents: await res.text(), loader: 'js' };
            });
        },
    };
}

/**
 * 装一个包。返回 { ok: true, name, version, file } 或 { ok: false, error }。
 * cdn 可以换(测试用本地假服务,或者用户所在网络访问不了 esm.sh 时换镜像):IIMOS_ESM_CDN。
 */
export async function addPackage({ workspace, spec, toolchain = toolchainDir(), cdn = process.env.IIMOS_ESM_CDN || 'https://esm.sh' }) {
    let parsed;
    try { parsed = parseSpec(spec); } catch (error) { return { ok: false, error: error.message }; }
    const ui = path.join(workspace, 'ui');
    const dir = path.join(ui, 'vendor');
    fs.mkdirSync(dir, { recursive: true });
    const url = `${cdn}/${parsed.pkg}${parsed.version ? `@${parsed.version}` : ''}${parsed.sub}?external=react,react-dom&target=es2022`;
    const esbuild = createRequire(path.join(toolchain, 'noop.js'))('esbuild');

    // 先拿入口:它的第一行注释里有解析出来的确切版本(/* esm.sh - dayjs@1.11.23 */)
    let entry;
    try {
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `找不到 ${spec}(${res.status}):${(await res.text()).slice(0, 200)}` };
        entry = await res.text();
    } catch (error) {
        return { ok: false, error: `连不上 ${cdn}:${error.message}。网络不通,或者需要换镜像(IIMOS_ESM_CDN)` };
    }
    const resolved = entry.match(/esm\.sh - (\S+)/)?.[1] || `${parsed.pkg}@${parsed.version || 'latest'}`;
    const version = resolved.slice(resolved.lastIndexOf('@') + 1);

    const file = vendorFile(parsed.name);
    try {
        await esbuild.build({
            entryPoints: [url],
            outfile: path.join(dir, file),
            bundle: true,
            format: 'esm',
            platform: 'browser',
            target: 'chrome130',
            minify: true,
            charset: 'utf8',
            external: EXTERNAL,
            plugins: [httpPlugin()],
            logLevel: 'silent',
        });
    } catch (error) {
        const messages = error.errors?.length
            ? (await esbuild.formatMessages(error.errors, { kind: 'error', color: false })).join('\n')
            : String(error.message || error);
        return { ok: false, error: messages.trim() };
    }

    const vendor = readVendor(ui);
    vendor[parsed.name] = { version, file, source: url, at: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, 'vendor.json'), `${JSON.stringify(vendor, null, 2)}\n`);
    return { ok: true, name: parsed.name, version, file };
}
