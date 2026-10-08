// 播种与升级:出厂的应用(seed,也就是仓库里的 app/ 目录)怎么进到用户的 workspace 里。
//
// 首次运行:把 seed 整个拷进 workspace,git init,打 seed-v<版本> 与 good。
// 装了新版本:
//   - 用户(和 agent)没动过 → 直接换成新 seed,用户无感
//   - 动过 → 不覆盖。写 .iimos/upgrade.json,由 agent 和用户商量怎么合进来
//     (旧出厂版在 seed-v<旧> 标签里,新出厂版在 seed 目录里,三方都在)
import fs from 'node:fs';
import path from 'node:path';
import * as snap from './snapshot.js';

/**
 * 永远不进 workspace 的东西:git 元数据、系统垃圾、依赖目录、运行态数据。
 * .data 是单独跑 server 时的数据目录(可能有 API Key),test 是出厂代码自己的测试。
 */
const SKIP = /^(\.data|test)([\\/]|$)|(^|[\\/])(\.git|\.DS_Store|node_modules|[^\\/]+\.db(-wal|-shm)?|[^\\/]+\.log)$/;

const GITIGNORE = `# 由 launcher 写入,可以改。
.iimos/
node_modules
.DS_Store
*.log
`;

export function readSeedVersion(seedDir, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(seedDir, 'package.json'), 'utf8')).version || fallback; } catch { return fallback; }
}

function copySeed(seedDir, workspace) {
    fs.mkdirSync(workspace, { recursive: true });
    fs.cpSync(seedDir, workspace, {
        recursive: true,
        force: true,
        verbatimSymlinks: true,
        filter: (src) => !SKIP.test(path.relative(seedDir, src) || '.'),
    });
    fs.writeFileSync(path.join(workspace, '.gitignore'), GITIGNORE);
}

/** 删掉 workspace 里除了 .git、.iimos 以外的一切。换成另一份 seed 之前用。 */
function clearWorkspace(workspace) {
    for (const entry of fs.readdirSync(workspace)) {
        if (entry === '.git' || entry === '.iimos') continue;
        fs.rmSync(path.join(workspace, entry), { recursive: true, force: true });
    }
}

export async function plant({ seedDir, workspace, version }) {
    if (fs.existsSync(path.join(workspace, '.git'))) return null;
    copySeed(seedDir, workspace);
    await snap.ensureRepo(workspace);
    const oid = await snap.commitAll(workspace, `播种 v${version}`);
    await snap.tag(workspace, `seed-v${version}`, oid);
    await snap.tag(workspace, 'good', oid);
    return oid;
}

/** 换成新的出厂 seed,当前样子留成 saveAs 分支。恢复出厂、无改动升级都走这里。 */
export async function replace({ seedDir, workspace, version, message, saveAs }) {
    const current = (await snap.commitAll(workspace, '换 seed 前自动快照')) || (await snap.head(workspace));
    if (saveAs && current) await snap.branch(workspace, saveAs, current);
    clearWorkspace(workspace);
    copySeed(seedDir, workspace);
    const oid = (await snap.commitAll(workspace, message)) || (await snap.head(workspace));
    await snap.tag(workspace, `seed-v${version}`, oid);
    await snap.tag(workspace, 'good', oid);
    return oid;
}

/**
 * launcher 换了版本(用户装了新安装包)之后第一次启动时调用。
 * 返回 { kind: 'none' | 'replaced' | 'pending' }。
 */
export async function upgrade({ seedDir, workspace, version, previous }) {
    if (!previous || previous === version) return { kind: 'none' };
    const base = await snap.resolve(workspace, `refs/tags/seed-v${previous}`);
    const current = await snap.head(workspace);
    const dirty = (await snap.changes(workspace)).length > 0;
    const untouched = base && current && !dirty
        && (await snap.treeOf(workspace, base)) === (await snap.treeOf(workspace, current));
    if (untouched) {
        await replace({ seedDir, workspace, version, message: `升级到 v${version}` });
        clearPending(workspace);
        return { kind: 'replaced' };
    }
    writePending(workspace, { from: previous, to: version, seed: seedDir, base: `seed-v${previous}`, at: new Date().toISOString() });
    return { kind: 'pending' };
}

const pendingFile = (workspace) => path.join(workspace, '.iimos', 'upgrade.json');
export function readPending(workspace) {
    try { return JSON.parse(fs.readFileSync(pendingFile(workspace), 'utf8')); } catch { return null; }
}
function writePending(workspace, value) {
    fs.mkdirSync(path.dirname(pendingFile(workspace)), { recursive: true });
    fs.writeFileSync(pendingFile(workspace), `${JSON.stringify(value, null, 2)}\n`);
}
export function clearPending(workspace) { fs.rmSync(pendingFile(workspace), { force: true }); }
