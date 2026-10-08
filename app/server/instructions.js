// 主模型的指令:由业务层准备,agent 原样透传。每一轮现读 —— 提示词、契约、AGENT.md 都可能刚被 agent 自己改过。
import fs from 'node:fs';
import path from 'node:path';

const read = (file, limit = 40_000) => {
    try { return fs.readFileSync(file, 'utf8').slice(0, limit); } catch { return ''; }
};

export function buildInstructions(workspace) {
    // prompt.md 按本模块的位置找:运行时本模块就在 workspace 里,改的就是同一份
    const parts = [read(path.join(import.meta.dirname, '..', 'agent', 'prompt.md'))];
    const contract = read(process.env.IIMOS_CONTRACT || '');
    if (contract) parts.push(contract);
    const agentDoc = read(path.join(workspace, 'AGENT.md'));
    if (agentDoc) parts.push(`# 当前的 AGENT.md\n\n${agentDoc}`);
    const rollback = read(path.join(workspace, '.iimos', 'rollback.json'));
    if (rollback) parts.push(`# 注意:应用被 launcher 回滚过\n\n${rollback}\n先告诉用户发生了什么。处理完后删掉 .iimos/rollback.json。`);
    const upgrade = read(path.join(workspace, '.iimos', 'upgrade.json'));
    if (upgrade) parts.push(`# 有新的出厂版本等着合并\n\n${upgrade}\n用 iimos upgrade 看详情,和用户商量怎么合。`);
    return parts.filter(Boolean).join('\n\n---\n\n');
}
