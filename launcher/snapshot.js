// 应用的版本史。纯 JS 的 git(isomorphic-git),用户机器上不需要装 git。
//
// 仓库是标准 git 仓库:用户或 agent 机器上有 git 的话,直接 `git log` 也看得到同一份历史。
//
// 约定的几个引用:
//   refs/heads/main          应用当前跑的版本
//   refs/tags/good           最近一个稳定跑过的版本,崩了就回这里
//   refs/tags/seed-v<x>      每个出厂版本播进来的那一刻
//   refs/heads/crashed-*     被回滚掉的版本,原样留着,改坏的东西不会丢
//   refs/heads/before-*      手动回滚/恢复出厂前的版本
import fs from 'node:fs';
import path from 'node:path';
import git from 'isomorphic-git';

const AUTHOR = { name: 'iimos', email: 'launcher@iimos.ai' };
const BRANCH = 'main';

const exists = (dir) => fs.existsSync(path.join(dir, '.git'));

export async function ensureRepo(dir) {
    if (exists(dir)) return false;
    await git.init({ fs, dir, defaultBranch: BRANCH });
    return true;
}

export async function head(dir) {
    try { return await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch { return null; }
}

export async function resolve(dir, ref) {
    try { return await git.resolveRef({ fs, dir, ref }); } catch { /* 不是引用 */ }
    try { return await git.expandOid({ fs, dir, oid: ref }); } catch { return null; }
}

/** 工作区里和 HEAD 不一样的文件。[路径, 状态],状态是 added / modified / deleted。 */
export async function changes(dir) {
    const rows = await git.statusMatrix({ fs, dir });
    const out = [];
    for (const [file, inHead, inWork] of rows) {
        if (inHead === 0 && inWork === 2) out.push([file, 'added']);
        else if (inHead === 1 && inWork === 2) out.push([file, 'modified']);
        else if (inHead === 1 && inWork === 0) out.push([file, 'deleted']);
    }
    return out;
}

/**
 * 把工作区的样子原样记一笔。没有变化就不提交,返回 null。
 * .gitignore 里的东西(node_modules 之类)不进历史。
 */
export async function commitAll(dir, message) {
    await ensureRepo(dir);
    const rows = await git.statusMatrix({ fs, dir });
    let dirty = false;
    for (const [file, inHead, inWork, inStage] of rows) {
        if (inWork === 0) {
            if (inHead || inStage) { await git.remove({ fs, dir, filepath: file }); dirty = true; }
        } else if (inHead !== inWork || inWork !== inStage) {
            await git.add({ fs, dir, filepath: file });
            dirty = true;
        }
    }
    const parent = await head(dir);
    if (!dirty && parent) return null;
    return git.commit({ fs, dir, message: String(message || '快照'), author: AUTHOR });
}

export async function log(dir, depth = 50) {
    if (!exists(dir)) return [];
    try {
        const entries = await git.log({ fs, dir, ref: BRANCH, depth });
        return entries.map(({ oid, commit }) => ({
            oid,
            message: commit.message.trim(),
            at: new Date(commit.author.timestamp * 1000).toISOString(),
        }));
    } catch { return []; }
}

export async function tag(dir, name, oid) {
    await git.writeRef({ fs, dir, ref: `refs/tags/${name}`, value: oid, force: true });
}

export async function branch(dir, name, oid) {
    await git.writeRef({ fs, dir, ref: `refs/heads/${name}`, value: oid, force: true });
}

export async function treeOf(dir, oid) {
    const { commit } = await git.readCommit({ fs, dir, oid });
    return commit.tree;
}

/**
 * 工作区整个换成某个版本的样子,等价 `git reset --hard <oid> && git clean -fd`。
 * 先把当前样子(含没提交的改动)记下来,留成 saveAs 分支 —— 回滚永远不丢东西。
 */
export async function resetHard(dir, oid, { saveAs } = {}) {
    const current = (await commitAll(dir, `回滚前自动快照`)) || (await head(dir));
    if (saveAs && current && current !== oid) await branch(dir, saveAs, current);
    await git.writeRef({ fs, dir, ref: `refs/heads/${BRANCH}`, value: oid, force: true });
    await git.checkout({ fs, dir, ref: BRANCH, force: true });
    // checkout 不删「目标版本里没有、也从没被追踪过」的新文件。
    // 不删的话,一个改坏的新文件回滚之后还在,照样把应用拖垮。
    for (const [file, inHead, inWork] of await git.statusMatrix({ fs, dir })) {
        if (inHead === 0 && inWork === 2) fs.rmSync(path.join(dir, file), { force: true });
    }
    removeEmptyDirs(dir);
    return current;
}

function removeEmptyDirs(dir, root = dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue;
        const child = path.join(dir, entry.name);
        removeEmptyDirs(child, root);
        if (child !== root && fs.readdirSync(child).length === 0) fs.rmdirSync(child);
    }
}
