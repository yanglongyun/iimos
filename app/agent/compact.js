// 上下文压缩。只有一个对话、永远不结束,没有压缩就撑不起长对话。
//
// 什么时候:agent 循环里每次请求模型前,上一次响应报的 usage.total_tokens ≥ config.compact_at
//           (上下文窗口的 70%,窗口由用户在模型配置里填)。
// 压什么:  留最后 config.keep 个条目,之前的交给模型写成交接摘要。切点只落在安全的地方:
//           一组工具调用全部有了结果之后,或者下一条是用户消息之前 —— 不拆开调用和它的结果。
// 怎么用:  摘要成为一条用户消息,替换掉被压缩的那段上下文(之前的摘要也在被压缩的范围里,自然合并)。
//           存储由调用方负责:对话里插一条 compaction 标记,原始条目不删,界面照样能往上翻。
import { callModel, message, outputText } from '../ai/index.js';

export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const COMPACT_RATIO = 0.7;
export const KEEP = 20;
export const COMPACT_SYSTEM = '把下面这段对话压成中文交接摘要,给之后接手的 iimos 看。iimos 是住在用户电脑里、按用户的话改造自己的 agent。'
    + '保留:用户要过什么、明确的偏好和约定、已经做过的改动(加了什么功能、改了哪些文件、数据存在哪)、当前进度、没做完的事、关键命令。'
    + '丢掉寒暄和中间试错。分条写,尽量短,不要开场白。';
export const COMPACT_PREFIX = '以下是此前对话的压缩摘要:\n\n';

/** 发给模型的条目类型;compaction 标记等界面用的条目不发。 */
const PROTOCOL = new Set(['message', 'function_call', 'function_call_output', 'reasoning']);

export const contextWindow = (config) => Number(config?.contextWindow) || DEFAULT_CONTEXT_WINDOW;

/** 最近一次压缩标记的位置,没有就是 -1。 */
export function lastCompaction(items) {
    for (let i = items.length - 1; i >= 0; i -= 1) if (items[i].type === 'compaction') return i;
    return -1;
}

/**
 * 重启接续标记在上下文里的样子:一条就在对话流里的消息。
 * 只放进系统指令不够 —— 模型看到自己上一步 restart 的结果是「马上重启」,会以为重启还没发生。
 */
export const RESTARTED = '[launcher] 重启完成:应用已经用新代码起来了(launcher 确认它报到了)。'
    + '这是你重启前那一轮的接续:确认刚才的改动真的生效了,然后用一两句话告诉用户结果。不要再 iimos restart。'
    + '如果系统指令里有「应用被 launcher 回滚过」的通知,说明新代码没起来,先如实告诉用户。';

/** 从全部条目里取出发给模型的上下文:最近一次压缩的摘要消息 + 它之后的条目(重启标记换成一条消息)。 */
export function liveItems(items) {
    const at = lastCompaction(items);
    const head = at >= 0 && items[at].item ? [items[at].item] : [];
    const rest = [];
    for (const item of items.slice(at + 1)) {
        if (PROTOCOL.has(item.type)) rest.push(item);
        else if (item.type === 'restart' && !item.stopped) rest.push(message(RESTARTED));
    }
    return [...head, ...rest];
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…(省略 ${text.length - max} 字)` : text);

/** 写成纯文本记录给摘要用:不带加密的思考块这类大而无用的字段,任何模型都能读。 */
export function transcript(items) {
    const lines = [];
    for (const item of items) {
        if (item.type === 'message') {
            const text = (item.content || []).map((part) => part.text || '').join('');
            lines.push(`${item.role === 'user' ? '用户' : 'iimos'}:${text}`);
        } else if (item.type === 'function_call') {
            lines.push(`[调用 ${item.name}] ${clip(String(item.arguments || ''), 1500)}`);
        } else if (item.type === 'function_call_output') {
            lines.push(`[结果] ${clip(typeof item.output === 'string' ? item.output : JSON.stringify(item.output), 1500)}`);
        }
    }
    return lines.join('\n');
}

/**
 * 找压缩范围 [0, count)。保留最后 keep 条;切点之前不能有还没返回结果的调用。
 * 可压的东西太少(≤ 1 条)返回 0。
 */
export function compactCount(messages, keep) {
    if (messages.length <= keep + 2) return 0;
    const limit = messages.length - keep;
    const pending = new Set();
    let count = 0;
    for (let i = 0; i < limit; i += 1) {
        const item = messages[i];
        if (item.type === 'function_call') pending.add(item.call_id);
        else if (item.type === 'function_call_output') pending.delete(item.call_id);
        const next = messages[i + 1];
        if (pending.size === 0 && (item.type === 'function_call_output' || (next?.type === 'message' && next.role === 'user'))) {
            count = i + 1;
        }
    }
    return count > 1 ? count : 0;
}

/**
 * 压缩 messages 的前一段。返回 { item, start, end, usage },调用方保存后由 agent 替换上下文;
 * 没东西可压返回 null。
 */
export default async function compact(messages, model, config, signal, onEvent = () => {}) {
    const count = compactCount(messages, config.keep ?? KEEP);
    if (!count) return null;
    await onEvent({ type: 'compact', status: 'started' });
    const response = await callModel(
        config.compact_system || COMPACT_SYSTEM,
        [message(transcript(messages.slice(0, count)))],
        model,
        config,
        [],
        (event) => (event.type === 'retry' ? onEvent(event) : undefined),
        signal,
    );
    signal?.throwIfAborted();
    const summary = response.output.map(outputText).join('');
    if (!summary.trim()) throw new Error('压缩没有返回摘要');
    return {
        item: message((config.compact_prefix || COMPACT_PREFIX) + summary.trim()),
        summary: summary.trim(),
        start: 0,
        end: count,
        usage: response.usage || null,
    };
}
