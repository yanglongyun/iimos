#!/usr/bin/env node
// `iimos` 命令:agent(和用户)跟 launcher 说话的唯一入口。
// 由 launcher/bin/iimos 垫片以 ELECTRON_RUN_AS_NODE 拉起,不需要机器上装 Node。
import fs from 'node:fs';
import path from 'node:path';
import { launcherPaths } from './paths.js';
import * as snap from './snapshot.js';
import * as seed from './seed.js';
import { readLedger } from './guardian.js';
import { buildUI } from './build.js';
import { addPackage } from './add.js';

const paths = launcherPaths();
const ws = paths.workspace;
const [command = 'help', ...args] = process.argv.slice(2);

const HELP = `iimos —— 和 launcher 说话

  iimos status                 当前版本、good、未提交的改动、待处理的升级
  iimos snapshot "说明"        把工作区现在的样子记一笔(改完一件事就记)
  iimos log [条数]             版本史
  iimos diff [版本]            和某个版本(默认 HEAD)比,哪些文件变了
  iimos rollback <版本|good>   工作区换回那个版本(当前样子留成分支),然后重启
  iimos add <包>[@版本]        从 esm.sh 装一个前端库到 ui/vendor/,之后照常 import(没有 npm 也能用)
  iimos build                  编译界面 ui/src → ui/dist(失败时 dist 不动,错误打出来)
  iimos reload                 先编译界面,成功了再重载窗口(只改了 ui/ 时用)
  iimos restart                先编译界面,再整个应用重启(改了 desktop/ server/ agent/ 时用)
  iimos recovery               打开救援窗口
  iimos upgrade                看新出厂版本的情况;iimos upgrade apply 直接换成新出厂版
  iimos paths                  launcher 用到的各个目录
`;

const out = (value) => process.stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
const fail = (message) => { process.stderr.write(`${message}\n`); process.exit(1); };
const short = (oid) => (oid ? oid.slice(0, 8) : '-');

async function control(route) {
    let info;
    try { info = JSON.parse(fs.readFileSync(paths.control, 'utf8')); } catch { fail('launcher 没在运行(找不到 control.json)'); }
    const response = await fetch(`http://127.0.0.1:${info.port}${route}`, {
        method: 'POST', headers: { authorization: `Bearer ${info.token}` },
    }).catch((error) => fail(`连不上 launcher:${error.message}`));
    const body = await response.json().catch(() => ({}));
    if (!response.ok) fail(body.error || `launcher 拒绝了:${response.status}`);
    return body;
}

const commands = {
    help: () => out(HELP),
    paths: () => out({ ...paths, seed: process.env.IIMOS_SEED || null }),

    async status() {
        const ledger = readLedger(paths.ledger);
        const changed = await snap.changes(ws);
        out({
            version: process.env.IIMOS_VERSION || null,
            head: short(await snap.head(ws)),
            good: short(await snap.resolve(ws, 'refs/tags/good')),
            boot: ledger.boot ? { ...ledger.boot, commit: short(ledger.boot.commit) } : null,
            uncommitted: changed.map(([file, kind]) => `${kind} ${file}`),
            lastRollback: ledger.lastRollback || null,
            pendingUpgrade: seed.readPending(ws),
        });
    },

    async snapshot() {
        const oid = await snap.commitAll(ws, args.join(' ') || '快照');
        out(oid ? `已记录 ${short(oid)}` : '没有变化,不用记');
    },

    async log() {
        const entries = await snap.log(ws, Number(args[0]) || 20);
        const good = await snap.resolve(ws, 'refs/tags/good');
        out(entries.map((e) => `${short(e.oid)}${e.oid === good ? ' [good]' : '       '} ${e.at.slice(0, 16).replace('T', ' ')}  ${e.message.split('\n')[0]}`).join('\n'));
    },

    async diff() {
        if (!args[0]) {
            const changed = await snap.changes(ws);
            return out(changed.length ? changed.map(([f, k]) => `${k} ${f}`).join('\n') : '工作区和 HEAD 一致');
        }
        const oid = await snap.resolve(ws, args[0]);
        if (!oid) fail(`找不到版本:${args[0]}`);
        const { default: git } = await import('isomorphic-git');
        const [a, b] = [await snap.treeOf(ws, oid), await snap.treeOf(ws, await snap.head(ws))];
        const changed = [];
        await git.walk({
            fs, dir: ws, trees: [git.TREE({ ref: oid }), git.TREE({ ref: 'HEAD' })],
            map: async (file, [x, y]) => {
                if (file === '.') return true;
                const [tx, ty] = [x && await x.type(), y && await y.type()];
                if (tx === 'tree' || ty === 'tree') return true;
                const [ox, oy] = [x && await x.oid(), y && await y.oid()];
                if (ox !== oy) changed.push(`${!x ? 'added' : !y ? 'deleted' : 'modified'} ${file}`);
                return true;
            },
        });
        out(a === b ? '没有差别' : changed.join('\n'));
    },

    async rollback() {
        const ref = args[0];
        if (!ref) fail('要回到哪个版本?iimos log 里挑一个,或写 good');
        const oid = await snap.resolve(ws, ref === 'good' ? 'refs/tags/good' : ref);
        if (!oid) fail(`找不到版本:${ref}`);
        const saveAs = `before-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await snap.resetHard(ws, oid, { saveAs });
        out(`工作区已换回 ${short(oid)},原来的样子留在分支 ${saveAs}。正在重启……`);
        await control('/restart');
    },

    add: async () => {
        if (!args[0]) fail('要装哪个包?比如 iimos add dayjs 或 iimos add dayjs@1');
        for (const spec of args) {
            const result = await addPackage({ workspace: ws, spec });
            if (!result.ok) fail(`装 ${spec} 失败:\n\n${result.error}`);
            out(`已装 ${result.name}@${result.version} → ui/vendor/${result.file},代码里 import '${result.name}' 即可`);
        }
    },
    build: async () => {
        const result = await buildUI({ workspace: ws });
        if (!result.ok) fail(`界面编译失败,ui/dist 没动:\n\n${result.error}`);
        out(result.skipped ? '没有 ui/src,不需要编译' : `界面已编译(${result.ms}ms)`);
    },
    reload: async () => {
        const result = await buildUI({ workspace: ws });
        if (!result.ok) fail(`界面编译失败,窗口没有重载(还是上一个能用的版本):\n\n${result.error}`);
        out(await control('/reload'));
    },
    restart: async () => {
        // 先编译:编不过就不重启,免得新后端配着旧界面起来
        const built = await buildUI({ workspace: ws });
        if (!built.ok) fail(`界面编译失败,没有重启:\n\n${built.error}`);
        const oid = await snap.commitAll(ws, args.join(' ') || '重启前自动快照');
        if (oid) out(`已记录 ${short(oid)}`);
        out(await control('/restart'));
    },
    recovery: async () => out(await control('/recovery')),

    async upgrade() {
        const pending = seed.readPending(ws);
        if (args[0] === 'done') { seed.clearPending(ws); return out('好,升级标记已清除'); }
        if (args[0] !== 'apply') {
            return out(pending ? {
                ...pending,
                hint: `旧出厂版在标签 ${pending.base},新出厂版在 ${pending.seed}。` +
                    '可以逐个文件比较后手动合进来,完成后 iimos upgrade done;或者 iimos upgrade apply 直接换成新出厂版。',
            } : '没有待处理的升级');
        }
        if (args[0] === 'apply' && pending) {
            const saveAs = `before-upgrade-${pending.to}`;
            await seed.replace({ seedDir: pending.seed, workspace: ws, version: pending.to, message: `升级到 v${pending.to}`, saveAs });
            seed.clearPending(ws);
            out(`已换成 v${pending.to},原来的样子留在分支 ${saveAs}。正在重启……`);
            return control('/restart');
        }
        fail('没有待处理的升级');
    },
};
const run = commands[command];
if (!run) fail(`不认识的命令:${command}\n\n${HELP}`);
await run();
