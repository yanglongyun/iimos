// 给模型的指令:prompt.md(角色)+ AGENT.md(形态自己的说明),每一轮现读 —— 它们可能刚被改过。
import fs from 'node:fs';
import path from 'node:path';

const read = (file, limit = 40_000) => {
    try { return fs.readFileSync(file, 'utf8').slice(0, limit); } catch { return ''; }
};

export function buildInstructions(workspace) {
    const parts = [read(path.join(import.meta.dirname, 'agent', 'prompt.md'))];
    const agentDoc = read(path.join(workspace, 'AGENT.md'));
    if (agentDoc) parts.push(`# 当前的 AGENT.md\n\n${agentDoc}`);
    const rollback = read(path.join(workspace, '.iimos', 'rollback.json'));
    if (rollback) parts.push(`# 注意:应用被 launcher 回滚过\n\n${rollback}`);
    return parts.filter(Boolean).join('\n\n---\n\n');
}
