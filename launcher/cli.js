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
  iimos restart                先编译界面,再整个应用重启(改了 main.js server/ agent/ 时用)
  iimos recovery               打开救援窗口
  iimos upgrade                看新出厂版本的情况;iimos upgrade apply 直接换成新出厂版
  iimos paths                  launcher 用到的各个目录

远程(手机、别的电脑经中继连进来,端到端加密):
  iimos pair [名字]            配对一台手机,打出二维码和链接(第一次会顺便打开远程)
  iimos pair --hands [名字]    配对一台电脑的「手」:大脑在这里,借那台电脑操作电脑和浏览器
  iimos devices                配对过的设备,谁在线
  iimos revoke <设备 id>       吊销一台设备
  iimos remote [on [中继地址]|off]   远程开关,默认中继 https://relay.iimos.ai

手(电脑操作、浏览器、通知):
  iimos hands                  连着的手和它们会的事
  iimos hands browser          拿浏览器插件的配对码
  iimos hands link <配对链接>  把这台电脑的手借给远处的 iimos;iimos hands unlink 断开
  iimos hands call <工具> '<json>'   直接让手做一件事,比如 iimos hands call notify '{"title":"hi"}'

分享(形态):
  iimos share "标题" [--story "让它长成这样的话"] [--dry-run] [--out 文件]   把现在的样子分享到社区(shapes.iimos.ai)
  iimos adopt <形态 id | 链接 | 文件> [--yes]                  换上别人分享的样子(先看清楚要换进来什么)
`;

const out = (value) => process.stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
const fail = (message) => { process.stderr.write(`${message}\n`); process.exit(1); };
const short = (oid) => (oid ? oid.slice(0, 8) : '-');

/** 和正在跑的 launcher 说话。soft:launcher 不在或拒绝时抛错,而不是直接退出(可有可无的事用)。 */
async function control(route, body, method = 'POST', soft = false) {
    const stop = soft ? (message) => { throw new Error(message); } : fail;
    let info;
    try { info = JSON.parse(fs.readFileSync(paths.control, 'utf8')); } catch { return stop('launcher 没在运行(找不到 control.json)'); }
    let response;
    try {
        response = await fetch(`http://127.0.0.1:${info.port}${route}`, {
            method,
            headers: { authorization: `Bearer ${info.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (error) { return stop(`连不上 launcher:${error.message}`); }
    const value = await response.json().catch(() => ({}));
    if (!response.ok) return stop(value.error || `launcher 拒绝了:${response.status}`);
    return value;
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

    async pair() {
        const hands = args.includes('--hands');
        const name = args.filter((a) => !a.startsWith('--')).join(' ') || undefined;
        const result = await control('/remote/pair', { name, kind: hands ? 'hands' : 'device' });
        try {
            const { default: QR } = await import('qrcode');
            out(await QR.toString(result.link, { type: 'terminal', small: true }));
        } catch { /* 没有 qrcode 就只打链接 */ }
        out(hands
            ? `在那台电脑上运行:iimos hands link '${result.link}'\n(这个链接就是钥匙,别发给别人)`
            : `手机扫码,或在手机浏览器打开:\n${result.link}\n(这个链接就是钥匙,别发给别人;不要了用 iimos revoke ${result.device.id})`);
    },
    async devices() {
        const status = await control('/remote', null, 'GET');
        out(status.enabled ? `远程:${status.connected ? '已连上' : '没连上'} ${status.relay} · 实例 ${status.instance}` : '远程没打开(iimos pair 会顺便打开)');
        out(status.devices.length
            ? status.devices.map((d) => `${d.online ? '●' : '○'} ${d.id}  ${d.kind === 'hands' ? '手' : '设备'}  ${d.name}  ${d.lastSeen ? `上次 ${d.lastSeen.slice(0, 16).replace('T', ' ')}` : '还没连过'}`).join('\n')
            : '还没有配对过的设备');
    },
    async revoke() {
        if (!args[0]) fail('要吊销哪台?iimos devices 里看 id');
        const result = await control('/remote/revoke', { id: args[0] });
        out(result.removed ? '已吊销,它立刻断开了' : '没有这台设备');
    },
    async remote() {
        if (args[0] === 'off') return out(await control('/remote/disable', {}));
        if (args[0] === 'on') return out(await control('/remote/enable', { relay: args[1] }));
        return out(await control('/remote', null, 'GET'));
    },
    async hands() {
        const [sub, ...rest] = args;
        if (!sub || sub === 'list') {
            const { hands } = await control('/hands', null, 'GET');
            return out(hands.length ? hands.map((h) => `${h.remote ? '远处' : '本机'}  ${h.name}  会:${h.tools.join('、')}`).join('\n') : '没有手连着');
        }
        if (sub === 'browser') {
            const { result } = await control('/hands/call', { tool: 'browser', args: { action: 'pair' } });
            return out(`在 Chrome 的 iimos 插件里填:\n  本机地址 ${result.address}\n  配对码   ${result.code}(${result.expiresIn}内有效,只能用一次)`);
        }
        if (sub === 'link') {
            if (!rest[0]) fail('把远处 iimos 上 iimos pair --hands 给的链接贴在后面');
            return out(await control('/hands/link', { link: rest[0] }));
        }
        if (sub === 'unlink') return out(await control('/hands/link', { link: null }));
        if (sub === 'call') {
            let callArgs = {};
            try { callArgs = rest[1] ? JSON.parse(rest[1]) : {}; } catch { fail('参数要是 JSON'); }
            return out((await control('/hands/call', { tool: rest[0], args: callArgs })).result);
        }
        return fail(`不认识:iimos hands ${sub}`);
    },
    async share() {
        const { share } = await import('./share.js');
        await share({ paths, args, out, fail, control });
    },
    async adopt() {
        const { adopt } = await import('./share.js');
        await adopt({ paths, args, out, fail, control });
    },

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
