// 形态的分享与换上(iimos share / iimos adopt)。格式见 shape.js,社区站见 site/。
//
// share:先把工作区记一笔,把版本库里的文件打包(不含任何用户数据,扫过密钥),截一张界面当封面,传到社区站。
// adopt:取回一个形态,先给人看清楚要换进来什么;加 --yes 才换。当前样子留成 before-shape-* 分支,
//        换上的形态起不来,launcher 照常回滚到 good —— 所以换形态和 agent 自己改坏一样,不会丢东西。
import fs from 'node:fs';
import path from 'node:path';

import * as snap from './snapshot.js';
import { GITIGNORE, readSeedVersion } from './seed.js';
import { EXCLUDE, LIMITS, base64, decodeShape, encodeShape, scanSecrets, validateShape } from './shape.js';

export const COMMUNITY = (process.env.IIMOS_COMMUNITY || 'https://iimos.ai').replace(/\/+$/, '');
const SHAPE_FILE = 'shape.json';

/** --key value 和位置参数。 */
function parseArgs(args) {
    const flags = {};
    const rest = [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            if (['dry-run', 'yes'].includes(key)) flags[key] = true;
            else flags[key] = args[++i];
        } else rest.push(arg);
    }
    return { flags, rest };
}

const readShapeInfo = (workspace) => { try { return JSON.parse(fs.readFileSync(path.join(workspace, SHAPE_FILE), 'utf8')); } catch { return null; } };
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export async function collect({ workspace, name, story, author, cover }) {
    await snap.commitAll(workspace, `分享前快照:${name}`);
    const files = [];
    const skipped = [];
    for (const file of await snap.listFiles(workspace)) {
        if (EXCLUDE.test(file) || file === SHAPE_FILE) continue;
        const full = path.join(workspace, file);
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        if (!stat.isFile()) continue;
        if (stat.size > LIMITS.file) { skipped.push(file); continue; }
        files.push({ path: file, data: base64.encode(fs.readFileSync(full)) });
    }
    const info = readShapeInfo(workspace);
    const lineage = [...(info?.lineage || []), ...(info?.id ? [{ id: info.id, name: info.name }] : [])];
    const shape = validateShape({
        format: 'iimos-shape/1', name, story, author, cover,
        seedVersion: readSeedVersion(workspace, ''), lineage, files,
    });
    return { shape, skipped };
}

export async function share({ paths, args, out, fail, control }) {
    const { flags, rest } = parseArgs(args);
    const name = (rest[0] || '').trim();
    if (!name) fail('用法:iimos share "标题" [--story "让它长成这样的话"] [--author 署名] [--dry-run] [--out 文件]');

    // 封面:截应用界面(launcher 没在跑或者没有窗口就没有封面)
    let cover = null;
    try { cover = (await control('/capture', {}, 'POST', true))?.png || null; } catch { /* 没封面也能分享 */ }

    let collected;
    try { collected = await collect({ workspace: paths.workspace, name, story: flags.story, author: flags.author, cover }); } catch (error) { fail(`打包失败:${error.message}`); }
    const { shape, skipped } = collected;
    const hits = scanSecrets(shape.files);
    if (hits.length) {
        fail(`没分享:这些地方像是密钥,分享出去别人就拿到了。\n${hits.map((h) => `  ${h.path}:${h.line}  ${h.label}`).join('\n')}\n把它们挪到 $IIMOS_DATA(比如 config.json),代码里去那里读,再分享。`);
    }
    const summary = [
        `形态「${shape.name}」:${shape.files.length} 个文件,${kb(shape.size)}${shape.cover ? ',带封面' : ''}`,
        shape.lineage.length ? `长自:${shape.lineage.map((x) => x.name).join(' → ')}` : null,
        skipped.length ? `太大没打进去:${skipped.join('、')}` : null,
        '不含任何用户数据(对话、配置、key 都在 $IIMOS_DATA,不在这里);密钥扫描通过。',
    ].filter(Boolean).join('\n');

    const bytes = await encodeShape(shape);
    if (flags.out) {
        fs.writeFileSync(flags.out, bytes);
        return out(`${summary}\n已写到 ${flags.out}(${kb(bytes.length)})。别人用 iimos adopt ${flags.out} 换上。`);
    }
    if (flags['dry-run']) return out(`${summary}\n(--dry-run:没上传。去掉 --dry-run 就会公开发到 ${COMMUNITY})`);

    const res = await fetch(`${COMMUNITY}/api/shapes`, { method: 'POST', headers: { 'content-type': 'application/gzip' }, body: bytes })
        .catch((error) => fail(`连不上社区站:${error.message}`));
    const value = await res.json().catch(() => ({}));
    if (!res.ok) fail(`社区站没收:${value.error || res.status}`);
    // 删除用的令牌只存在本机
    const file = path.join(paths.data, 'shares.json');
    let mine = [];
    try { mine = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 第一次 */ }
    mine.push({ id: value.id, name: shape.name, url: value.url, editToken: value.editToken, createdAt: new Date().toISOString() });
    fs.mkdirSync(paths.data, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(mine, null, 2), { mode: 0o600 });
    return out(`${summary}\n已发布:${value.url}\n别人换上它:iimos adopt ${value.id}`);
}

/** 来源可以是本地文件、形态 id、或者形态页的链接。 */
async function fetchShape(source, { preview = false } = {}) {
    if (fs.existsSync(source)) return { bytes: new Uint8Array(fs.readFileSync(source)), id: null, origin: null };
    let base = COMMUNITY;
    let id = source;
    if (/^https?:\/\//.test(source)) {
        const url = new URL(source);
        base = url.origin;
        id = url.pathname.match(/\/(?:s|api\/shapes)\/([\w-]+)/)?.[1];
    }
    if (!id || !/^[\w-]{4,40}$/.test(id)) throw new Error('不认识这个形态:给一个形态 id、形态页链接,或者本地的 .iimos-shape 文件');
    // 只看不换不算一次「换上」
    const res = await fetch(`${base}/api/shapes/${id}/bundle${preview ? '?preview=1' : ''}`);
    if (!res.ok) throw new Error(res.status === 404 ? '社区站上没有这个形态(可能被作者删了)' : `下载失败:${res.status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), id, origin: base };
}

export async function adopt({ paths, args, out, fail, control }) {
    const { flags, rest } = parseArgs(args);
    if (!rest[0]) fail('用法:iimos adopt <形态 id | 链接 | 文件> [--yes]');
    let fetched;
    let shape;
    try {
        fetched = await fetchShape(rest[0], { preview: !flags.yes });
        shape = await decodeShape(fetched.bytes);
    } catch (error) { return fail(error.message); }
    const workspace = paths.workspace;

    // 和现在比:多了、改了、少了
    const incoming = new Map(shape.files.map((f) => [f.path, f.data]));
    const current = (await snap.listFiles(workspace).catch(() => [])).filter((f) => !EXCLUDE.test(f) && f !== SHAPE_FILE);
    let changed = 0;
    for (const file of current) {
        if (!incoming.has(file)) continue;
        try { if (base64.encode(fs.readFileSync(path.join(workspace, file))) !== incoming.get(file)) changed += 1; } catch { changed += 1; }
    }
    const added = [...incoming.keys()].filter((f) => !current.includes(f));
    const removed = current.filter((f) => !incoming.has(f));
    const summary = [
        `形态「${shape.name}」${shape.author ? ` · ${shape.author}` : ''}${shape.seedVersion ? ` · 出厂 v${shape.seedVersion}` : ''}`,
        shape.story ? `它是这样长出来的:${shape.story.slice(0, 400)}${shape.story.length > 400 ? '…' : ''}` : null,
        shape.lineage.length ? `长自:${shape.lineage.map((x) => x.name).join(' → ')}` : null,
        `${shape.files.length} 个文件,${kb(shape.size)}。和现在比:新增 ${added.length},改动 ${changed},去掉 ${removed.length}。`,
        added.length ? `新增的:${added.slice(0, 30).join('、')}${added.length > 30 ? ` 等 ${added.length} 个` : ''}` : null,
        '注意:形态就是代码,换上之后它会在这台电脑上运行。只换你信得过的。你的数据(对话、配置、key)不会被替换。',
    ].filter(Boolean).join('\n');
    if (!flags.yes) return out(`${summary}\n\n确认换上:iimos adopt ${rest[0]} --yes\n现在的样子会留成一个分支,随时 iimos rollback 回来。`);

    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const before = (await snap.commitAll(workspace, '换形态前自动快照')) || (await snap.head(workspace));
    const saveAs = `before-shape-${stamp}`;
    if (before) await snap.branch(workspace, saveAs, before);
    for (const entry of fs.readdirSync(workspace)) {
        if (entry === '.git' || entry === '.iimos') continue;
        fs.rmSync(path.join(workspace, entry), { recursive: true, force: true });
    }
    for (const file of shape.files) {
        const full = path.join(workspace, file.path);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, base64.decode(file.data));
    }
    if (!incoming.has('.gitignore')) fs.writeFileSync(path.join(workspace, '.gitignore'), GITIGNORE);
    fs.writeFileSync(path.join(workspace, SHAPE_FILE), JSON.stringify({
        id: fetched.id, name: shape.name, author: shape.author, from: fetched.origin, adoptedAt: new Date().toISOString(), lineage: shape.lineage,
    }, null, 2));
    const oid = await snap.commitAll(workspace, `换上形态「${shape.name}」`);
    let restarted = false;
    try { await control('/restart', {}, 'POST', true); restarted = true; } catch { /* launcher 没在跑 */ }
    return out(`${summary}\n\n换上了(${oid?.slice(0, 8)})。原来的样子在分支 ${saveAs},想回去:iimos rollback ${saveAs}\n${restarted ? '正在重启……' : '下次打开 iimos 就是新样子。'}`);
}
