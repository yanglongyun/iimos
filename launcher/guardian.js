// 启动记账与回滚。应用随便改,launcher 只认「起没起来」。
//
// 一次启动:
//   1. 上次启动没报到(没调 ready 就死了,或明确报了失败)→ 记一次失败
//   2. 工作区里没提交的改动先记一笔快照 —— agent 改到一半的东西也算数
//   3. 同一个版本连续失败 MAX_STRIKES 次 → 当前版本留成 crashed-* 分支,回滚到 good
//      已经在 good 上还起不来 → 不再硬起,交给救援窗口
//   4. 本次启动记为 pending,等应用报到
// 应用报到(ready)后稳定跑满 HEALTHY_MS,这个版本就成为新的 good。
import fs from 'node:fs';
import path from 'node:path';
import * as snap from './snapshot.js';

export const MAX_STRIKES = 2;
export const HEALTHY_MS = Number(process.env.IIMOS_HEALTHY_MS) || 3 * 60_000;

export function readLedger(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
export function writeLedger(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, file);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const noticeFile = (workspace) => path.join(workspace, '.iimos', 'rollback.json');

/** 告诉应用「你被回滚过」。agent 每轮读它,醒来就知道发生了什么。 */
function writeNotice(workspace, value) {
    fs.mkdirSync(path.dirname(noticeFile(workspace)), { recursive: true });
    fs.writeFileSync(noticeFile(workspace), `${JSON.stringify(value, null, 2)}\n`);
}
export function readNotice(workspace) {
    try { return JSON.parse(fs.readFileSync(noticeFile(workspace), 'utf8')); } catch { return null; }
}

export async function beginBoot({ workspace, ledgerFile }) {
    const ledger = readLedger(ledgerFile);
    await snap.commitAll(workspace, '启动前自动快照');
    const current = await snap.head(workspace);
    const good = (await snap.resolve(workspace, 'refs/tags/good')) || ledger.good || null;

    const last = ledger.boot;
    let strikes = ledger.strikes || 0;
    if (last && last.status !== 'ready') {
        strikes = last.commit === current ? strikes + 1 : 1;
    } else {
        strikes = 0;
    }

    let rolledBack = null;
    let target = current;
    if (strikes >= MAX_STRIKES) {
        if (good && good !== current) {
            const saveAs = `crashed-${stamp()}`;
            await snap.resetHard(workspace, good, { saveAs });
            rolledBack = {
                at: new Date().toISOString(),
                from: current, to: good, branch: saveAs,
                reason: last?.error || '连续启动失败',
            };
            writeNotice(workspace, rolledBack);
            target = good;
            strikes = 0;
        } else {
            ledger.strikes = strikes;
            writeLedger(ledgerFile, ledger);
            return { action: 'recovery', reason: last?.error || '在稳定版本上也起不来', commit: current };
        }
    }

    ledger.good = good;
    ledger.strikes = strikes;
    ledger.boot = { commit: target, at: new Date().toISOString(), status: 'pending' };
    if (rolledBack) ledger.lastRollback = rolledBack;
    writeLedger(ledgerFile, ledger);
    return { action: 'run', commit: target, rolledBack };
}

export function markReady({ ledgerFile }) {
    const ledger = readLedger(ledgerFile);
    if (!ledger.boot || ledger.boot.status === 'ready') return ledger.boot?.commit || null;
    ledger.boot.status = 'ready';
    ledger.boot.readyAt = new Date().toISOString();
    ledger.strikes = 0;
    writeLedger(ledgerFile, ledger);
    return ledger.boot.commit;
}

export function markFailed({ ledgerFile }, error) {
    const ledger = readLedger(ledgerFile);
    if (!ledger.boot || ledger.boot.status === 'ready') return;
    ledger.boot.status = 'failed';
    ledger.boot.error = String(error?.stack || error?.message || error).slice(0, 4000);
    writeLedger(ledgerFile, ledger);
}

/** 稳定跑满了:这次启动的版本升为 good。 */
export async function promote({ workspace, ledgerFile }) {
    const ledger = readLedger(ledgerFile);
    const commit = ledger.boot?.status === 'ready' ? ledger.boot.commit : null;
    if (!commit) return null;
    await snap.tag(workspace, 'good', commit);
    ledger.good = commit;
    writeLedger(ledgerFile, ledger);
    return commit;
}

/** 下一次启动会不会自动回滚。失败后用它决定「重启再试」还是「直接开救援」。 */
export async function willRecover({ workspace, ledgerFile }) {
    const ledger = readLedger(ledgerFile);
    const current = await snap.head(workspace);
    const good = await snap.resolve(workspace, 'refs/tags/good');
    return Boolean(good && good !== current) || (ledger.strikes || 0) + 1 < MAX_STRIKES;
}
