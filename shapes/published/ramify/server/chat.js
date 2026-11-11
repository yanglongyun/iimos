// 每个项目一条对话(业务层)。准备指令和上下文,调 agent 的 run(),接它的九种事件:存库、推给界面。
//
// 条目原样存进 messages 表(Responses 协议的 input item,用户消息额外带 display / node 两个只给界面看的字段,
// 发给模型前剥掉)。压缩发生在 agent 循环里(agent/compact.js),这里收到完成事件后存一条 compaction
// (覆盖到某条消息为止);下次发给模型的上下文 = 最近一条摘要 + 它之后的消息。
//
// 推给界面的事件(都带 project_id):
//   delta     { text }                 正文增量
//   item      { item }                 完整条目(带 id、created_at)
//   state     { running }              开始 / 结束
//   usage     { tokens }
//   retry     { attempt, maxRetries, error }
//   compacting / compacted
//   error     { message }
//   node      { node }                 某个节点被写入 / 新建 / 标失败(画布用)
import { run as runAgent } from './agent/index.js';
import { COMPACT_RATIO, KEEP, contextWindow } from './agent/compact.js';
import { readConfig, modelReady } from './config.js';
import { buildInstructions } from './instructions.js';
import * as store from './db.js';

const CONTENT_LIMIT = 40_000;
const PROTOCOL = new Set(['message', 'function_call', 'function_call_output', 'reasoning']);

/** 只给界面看的字段剥掉,模型只认协议字段。 */
export function protocolItem(item) {
    const { id, created_at, display, node, ...rest } = item;
    return rest;
}

/** 用户这句话发给模型的样子:带上选中节点的内容和「出几版」的要求。 */
export function composeUserText({ text, node, count, rootId = '根节点' }) {
    const lines = [text.trim()];
    if (node) {
        const body = node.content ? (node.content.length > CONTENT_LIMIT ? `${node.content.slice(0, CONTENT_LIMIT)}\n…(内容太长,已截断,完整内容用 read_tree 看)` : node.content) : '(还没有内容)';
        lines.push(`[用户此刻选中了节点 ${node.id}「${node.title}」(${node.type})。这句话是针对它说的。它的内容:\n${body}\n]`);
        if (count) lines.push(`[请在这个节点下新开一轮:add_nodes(parent_id=${node.id}, count=${count}, round=修改要求),然后逐个 write_node。]`);
    } else if (count) {
        lines.push(`[请在根节点下生成 ${count} 个方向明显不同的方案:先 add_nodes(parent_id=${rootId}, count=${count}),再逐个 write_node。]`);
    }
    return lines.join('\n\n');
}

export class Chats {
    constructor({ db, workspace, data, bin, emit }) {
        this.db = db;
        this.workspace = workspace;
        this.data = data;
        this.bin = bin;
        this.emit = emit;
        this.active = new Map();   // project id → { controller, partial, runId }
    }

    running(projectId) { return this.active.has(projectId); }
    partial(projectId) { return this.active.get(projectId)?.partial || ''; }

    /** 用户开口:存一条用户消息,开始一轮。 */
    send(projectId, { text, nodeId = null, count = 0 }) {
        const content = String(text || '').trim();
        if (!content) throw Object.assign(new Error('说点什么'), { status: 400 });
        if (!store.getProject(this.db, projectId)) throw Object.assign(new Error('没有这个项目'), { status: 404 });
        if (this.active.has(projectId)) throw Object.assign(new Error('上一句还没说完'), { status: 409 });
        const config = readConfig(this.data);
        if (!modelReady(config)) throw Object.assign(new Error('还没配置模型'), { status: 400 });
        let node = null;
        if (nodeId) {
            node = store.getNode(this.db, nodeId);
            if (!node || node.project_id !== projectId) throw Object.assign(new Error('选中的节点不在这个项目里'), { status: 400 });
        }
        const n = count ? Math.max(1, Math.min(8, Math.round(Number(count)) || 1)) : 0;
        const rootId = store.listNodes(this.db, projectId).find((row) => row.parent_id === null)?.id;
        const item = {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: composeUserText({ text: content, node, count: n, rootId }) }],
            display: content,
            node: node ? { id: node.id, title: node.title, count: n } : (n ? { count: n } : undefined),
        };
        const saved = store.saveMessage(this.db, projectId, item);
        this.emit({ type: 'item', project_id: projectId, item: saved });
        this.start(projectId, config);
        return saved;
    }

    stop(projectId) {
        const entry = this.active.get(projectId);
        if (!entry) return false;
        entry.controller.abort();
        return true;
    }

    stopAll() { for (const entry of this.active.values()) entry.controller.abort(); }

    start(projectId, config) {
        const controller = new AbortController();
        const entry = { controller, partial: '', runId: store.newId() };
        this.active.set(projectId, entry);
        this.emit({ type: 'state', project_id: projectId, running: true });
        void this.run(projectId, config, entry)
            .catch((error) => this.emit({ type: 'error', project_id: projectId, message: error.message || String(error) }))
            .finally(() => {
                const marked = store.failEmptyPlaceholders(this.db, entry.runId, '这一轮结束了还没写上内容');
                for (const id of marked) this.emit({ type: 'node', project_id: projectId, node: store.getNode(this.db, id) });
                this.active.delete(projectId);
                this.emit({ type: 'state', project_id: projectId, running: false });
            });
    }

    async run(projectId, config, entry) {
        const live = store.liveMessages(this.db, projectId);
        // 上下文数组:摘要消息 + 之后的条目(剥掉界面字段);rows 与 messages 下标对齐,压缩时靠它找到覆盖到哪条
        const rows = live.items.filter((item) => PROTOCOL.has(item.type));
        const messages = [...(live.head ? [live.head] : []), ...rows.map(protocolItem)];
        const headCount = live.head ? 1 : 0;
        const canvas = {
            db: this.db,
            projectId,
            runId: entry.runId,
            onChange: (node) => this.emit({ type: 'node', project_id: projectId, node }),
        };
        const window = contextWindow(config);
        const tokens = store.getTokens(this.db, projectId);
        await runAgent({
            instructions: buildInstructions(this.workspace),
            messages,
            model: config.model,
            config: {
                url: config.responsesUrl,
                key: config.apiKey,
                // 正文增量只用来显示,断流后整段重来没有副作用
                retryAfterDelivery: true,
                workdir: this.workspace,
                bin: this.bin,
                timeout: 120,
                max_output: 30_000,
                compact_at: Math.floor(window * COMPACT_RATIO),
                keep: KEEP,
                canvas,
            },
            usage: tokens ? { total_tokens: tokens } : null,
            signal: entry.controller.signal,
            onEvent: (event) => this.onAgentEvent(projectId, entry, event, { rows, headCount }),
        });
    }

    onAgentEvent(projectId, entry, event, context) {
        const push = (item) => {
            const saved = store.saveMessage(this.db, projectId, item);
            context.rows.push(saved);
            this.emit({ type: 'item', project_id: projectId, item: saved });
        };
        switch (event.type) {
            case 'message':
                if (event.delta) { entry.partial += event.delta; this.emit({ type: 'delta', project_id: projectId, text: event.delta }); return; }
                entry.partial = '';
                push(event.item);
                return;
            case 'reasoning':
                if (event.item) push(event.item);
                return;
            case 'function_call':
            case 'function_call_output':
                push(event.item);
                return;
            case 'usage': {
                const tokens = Number(event.usage?.total_tokens) || 0;
                store.setTokens(this.db, projectId, tokens);
                this.emit({ type: 'usage', project_id: projectId, tokens });
                return;
            }
            case 'compact': {
                if (event.status === 'started') { this.emit({ type: 'compacting', project_id: projectId }); return; }
                // 被压缩的是 messages[start, end):摘要覆盖到 rows 里对应 end-1 的那条
                const covered = context.rows[event.end - 1 - context.headCount];
                if (covered) store.saveCompaction(this.db, projectId, { messageId: covered.id, summary: event.summary, item: event.item });
                store.setTokens(this.db, projectId, 0);
                this.emit({ type: 'compacted', project_id: projectId });
                return;
            }
            case 'retry':
                this.emit({ type: 'retry', project_id: projectId, attempt: event.attempt, maxRetries: event.maxRetries, error: event.error });
                return;
            case 'error':
                this.emit({ type: 'error', project_id: projectId, message: event.error });
                return;
            case 'done':
                if (event.status === 'aborted') this.emit({ type: 'error', project_id: projectId, message: '已停止' });
                return;
            default:
        }
    }
}
