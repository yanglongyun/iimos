// 主模型的指令:由业务层准备,agent 原样透传。每一轮现读 —— 提示词、契约、AGENT.md 都可能刚被 agent 自己改过。
import fs from 'node:fs';
import path from 'node:path';

const read = (file, limit = 40_000) => {
    try { return fs.readFileSync(file, 'utf8').slice(0, limit); } catch { return ''; }
};

/** 此刻的处境:时间、有哪些手。每轮现算,一两行。 */
function situation(data) {
    const now = new Date();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const lines = [`现在是 ${now.toLocaleString('zh-CN', { hour12: false, weekday: 'long' })}(${zone})。`];
    const iimos = globalThis.iimos;
    if (iimos) {
        lines.push('你跑在用户的电脑上。');
        const hands = iimos.hands?.list() || [];
        lines.push(hands.length
            ? `能用的手:${hands.map((h) => `${h.name}(${h.tools.join('、')})`).join(';')}。`
            : '现在没有可用的手(电脑操作、浏览器、通知都用不了)。');
    }
    lines.push(`记忆文件:${path.join(data, 'memory.md')}(下面是它现在的内容)。`);
    return `# 此刻\n\n${lines.join('\n')}`;
}

export function buildInstructions(workspace, data) {
    // prompt.md 按本模块的位置找:运行时本模块就在 workspace 里,改的就是同一份
    const parts = [read(path.join(import.meta.dirname, 'agent', 'prompt.md'))];
    const contract = read(process.env.IIMOS_CONTRACT || '');
    if (contract) parts.push(contract);
    const agentDoc = read(path.join(workspace, 'AGENT.md'));
    if (agentDoc) parts.push(`# 当前的 AGENT.md\n\n${agentDoc}`);
    if (data) {
        parts.push(situation(data));
        const memory = read(path.join(data, 'memory.md'), 20_000).trim();
        parts.push(`# 你记得的关于用户的事(memory.md)\n\n${memory || '(还是空的)'}`);
    }
    const rollback = read(path.join(workspace, '.iimos', 'rollback.json'));
    if (rollback) parts.push(`# 注意:应用被 launcher 回滚过\n\n${rollback}\n先告诉用户发生了什么。处理完后删掉 .iimos/rollback.json。`);
    const upgrade = read(path.join(workspace, '.iimos', 'upgrade.json'));
    if (upgrade) parts.push(`# 有新的出厂版本等着合并\n\n${upgrade}\n用 iimos upgrade 看详情,和用户商量怎么合。`);
    return parts.filter(Boolean).join('\n\n---\n\n');
}
