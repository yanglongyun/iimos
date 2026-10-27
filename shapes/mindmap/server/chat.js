// 每张导图一条对话(业务层)。准备指令和上下文,调 agent 的 run(),接它的九种事件:存库、推给界面。
//
// 条目原样存进 messages 表(Responses 协议的 input item,用户消息额外带 display / node 两个只给界面看的字段,
// 发给模型前剥掉)。压缩发生在 agent 循环里(agent/compact.js),这里收到完成事件后存一条 compaction
// (覆盖到某条消息为止);下次发给模型的上下文 = 最近一条摘要 + 它之后的消息。
//
// 推给界面的事件(都带 project_id):
//   delta / item / state / usage / retry / compacting / compacted / error
import { run as runAgent } from './agent/index.js';
import { COMPACT_RATIO, KEEP, contextWindow } from './agent/compact.js';
import { readConfig, modelReady } from './config.js';
import { buildInstructions } from './instructions.js';
import * as store from './db.js';

const NOTE_LIMIT = 6000;
const PROTOCOL = new Set(['message', 'function_call', 'function_call_output', 'reasoning']);

/** 只给界面看的字段剥掉,模型只认协议字段。 */
export function protocolItem(item) {
    const { id, created_at, display, node, ...rest } = item;
    return rest;
}

function subtreeText(nodes, rootId) {
    const children = new Map();
    for (const node of nodes) {
        if (!node.parent_id) continue;
        if (!children.has(node.parent_id)) children.set(node.parent_id, []);
        children.get(node.parent_id).push(node);
    }
    const lines = [];
    const walk = (id, depth) => {
        const node = nodes.find((n) => n.id === id);
        if (!node) return;
        lines.push(`${'  '.repeat(depth)}- ${node.title}${node.note ? `:${node.note.slice(0, 160)}` : ''}`);
        for (const child of (children.get(id) || []).sort((a, b) => a.position - b.position)) walk(child.id, depth + 1);
    };
    walk(rootId, 0);
    return lines.join('\n');
}

/** 用户这句话发给模型的样子:带上选中主题、它的备注和下面已有的结构。 */
export function composeUserText({ text, node, nodes = [], initial = false }) {
    const lines = [String(text || '').trim()];
    if (initial) {
        lines.push(`[这是一张新导图,中心主题是「${String(text || '').trim()}」。请先用 read_map 看一眼,然后用 add_topics 在根主题下搭出 3–6 个主要分支;每个分支给一句 note。先不要一次铺满所有叶子。]`);
    } else if (node) {
        lines.push(`[用户此刻选中了主题 ${node.id}「${node.title}」。这句话是针对它说的。它的备注:${node.note ? node.note.slice(0, NOTE_LIMIT) : '(空)'}]`);
        if (nodes.length) lines.push(`[这个主题下面现在的结构:\n${subtreeText(nodes, node.id)}\n]`);
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
    send(projectId, { text, nodeId = null, initial = false }) {
        const content = String(text || '').trim();
        if (!content) throw Object.assign(new Error('说点什么'), { status: 400 });
        const project = store.getProject(this.db, projectId);
        if (!project) throw Object.assign(new Error('没有这个导图'), { status: 404 });
        if (this.active.has(projectId)) throw Object.assign(new Error('上一句还没说完'), { status: 409 });
        const config = readConfig(this.data);
        if (!modelReady(config)) throw Object.assign(new Error('还没配置模型'), { status: 400 });
        let node = null;
        if (nodeId) {
            node = store.getNode(this.db, nodeId);
            if (!node || node.project_id !== projectId) throw Object.assign(new Error('选中的主题不在这张导图里'), { status: 400 });
        }
        const nodes = store.listNodes(this.db, projectId);
        const item = {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: composeUserText({ text: content, node, nodes, initial }) }],
            display: content,
            node: node ? { id: node.id, title: node.title } : undefined,
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
            onDelete: (ids) => { for (const id of ids) this.emit({ type: 'node_deleted', project_id: projectId, id }); },
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
