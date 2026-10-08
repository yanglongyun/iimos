// 唯一的那个对话(业务层)。准备指令和上下文,调 agent 的 run(),接它的九种事件:存盘、推给界面。
//
// 全部条目原样存进 $IIMOS_DATA/conversation.json,每完成一步就落一次盘:agent 可能在这一轮里
// `iimos restart` 把整个应用连同自己一起重启,落了盘的东西才算数。
//
// 重启接续:agent 自己 `iimos restart` 时,这一轮会连同应用一起被打断。launcher 重启前调 shutdown(),
// 这里记下 interrupted;新进程起来后 resumeIfInterrupted() 自动把这一轮接着跑完 —— 确认改动生效、
// 告诉用户结果。连续接续最多 MAX_RESUMES 次,防止「改 → 重启 → 再改 → 再重启」停不下来。
//
// 压缩发生在 agent 循环里(agent/compact.js)。这里收到 compact 完成事件后,在被保留的第一条之前
// 插一条 { type: 'compaction', summary, item } 标记;原始条目不删。下次发给模型的上下文由
// liveItems() 从最近一个标记开始取(标记里的摘要消息 + 它之后的条目)。
import fs from 'node:fs';
import path from 'node:path';

import { run } from '../agent/index.js';
import { COMPACT_RATIO, KEEP, contextWindow, liveItems } from '../agent/compact.js';
import { readConfig } from './config.js';
import { buildInstructions } from './instructions.js';

const INTERRUPTED = '(应用在这条命令执行期间重启了,没拿到结果。需要的话重新执行一次。)';
const MAX_RESUMES = 3;

export class Conversation {
    constructor({ workspace, data, bin, emit }) {
        this.workspace = workspace;
        this.data = data;
        this.bin = bin;
        this.emit = emit;
        this.file = path.join(data, 'conversation.json');
        const saved = this.load();
        this.items = saved.items;
        this.tokens = saved.tokens;   // 上一次模型响应报的 total_tokens,agent 据此判断要不要压缩
        this.interrupted = saved.interrupted;   // 上一轮是不是被 launcher 的重启打断的
        this.resumes = saved.resumes;           // 连续自动接续了几次
        this.shuttingDown = false;
        this.running = null;          // AbortController
        this.partial = '';            // 正在流式输出、还没成为完整条目的那段文字
    }

    load() {
        let saved = {};
        try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* 第一次 */ }
        const items = saved.items || [];
        // 上次在工具执行中途被重启:有 function_call 没有对应的 output,协议上下一次请求会被拒。补上
        const answered = new Set(items.filter((item) => item.type === 'function_call_output').map((item) => item.call_id));
        const repaired = [];
        for (const item of items) {
            repaired.push(item);
            if (item.type === 'function_call' && !answered.has(item.call_id)) {
                repaired.push({ type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ success: false, text: INTERRUPTED }) });
            }
        }
        return { items: repaired, tokens: Number(saved.tokens) || 0, interrupted: Boolean(saved.interrupted), resumes: Number(saved.resumes) || 0 };
    }

    save() {
        fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({
            tokens: this.tokens, interrupted: this.interrupted, resumes: this.resumes, items: this.items,
        }));
        fs.renameSync(`${this.file}.tmp`, this.file);
    }

    snapshot() {
        return { running: Boolean(this.running), items: this.items, partial: this.partial, tokens: this.tokens };
    }

    push(item) {
        this.items.push(item);
        this.save();
        this.emit({ type: 'item', item });
    }

    setRunning(controller) {
        this.running = controller;
        this.partial = '';
        this.emit({ type: 'state', running: Boolean(controller) });
    }

    send(text) {
        if (!text.trim()) throw Object.assign(new Error('说点什么'), { status: 400 });
        if (this.running) throw Object.assign(new Error('上一句还没说完'), { status: 409 });
        const config = readConfig(this.data);
        if (!(config.responsesUrl && config.apiKey && config.model)) {
            throw Object.assign(new Error('还没配置模型'), { status: 400 });
        }
        // 用户开口了:之前的连续接续计数作废
        this.resumes = 0;
        this.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
        this.start(config);
    }

    start(config, note = '') {
        const controller = new AbortController();
        this.setRunning(controller);
        void this.run(config, controller, note).finally(() => this.setRunning(null));
    }

    stop() {
        this.running?.abort();
    }

    /** launcher 重启前调用:正在跑的这一轮记成「被重启打断」,新进程起来后接着跑。用户退出应用不走这里。 */
    shutdown() {
        this.shuttingDown = true;
        if (this.running) {
            this.interrupted = true;
            this.save();
        }
        this.stop();
    }

    /**
     * 新进程起来后调用:上一轮是被重启打断的,就在对话里记一条 restart 标记,把这一轮接着跑完。
     * 标记发给模型时是一条「重启完成」的消息(agent/compact.js 的 liveItems),让它知道重启已经过去了。
     */
    resumeIfInterrupted() {
        if (!this.interrupted || this.running) return;
        this.interrupted = false;
        const config = readConfig(this.data);
        if (!(config.responsesUrl && config.apiKey && config.model)) { this.save(); return; }
        if (this.resumes >= MAX_RESUMES) {
            this.push({ type: 'restart', stopped: true, at: new Date().toISOString() });
            return;
        }
        this.resumes += 1;
        this.push({ type: 'restart', at: new Date().toISOString() });
        this.start(config);
    }

    async run(config, controller, note = '') {
        // 上下文数组和 this.items 共用同一批条目对象:agent 往里追加、压缩时替换,
        // 这里在事件里把同一个对象存进 this.items,压缩时靠对象身份找到插标记的位置
        const messages = liveItems(this.items);
        const window = contextWindow(config);
        const result = await run({
            instructions: [buildInstructions(this.workspace), note].filter(Boolean).join('\n\n---\n\n'),
            messages,
            model: config.model,
            config: {
                url: config.responsesUrl,
                key: config.apiKey,
                workdir: this.workspace,
                bin: this.bin,
                timeout: 120,
                max_output: 30_000,
                compact_at: Math.floor(window * COMPACT_RATIO),
                keep: KEEP,
            },
            usage: this.tokens ? { total_tokens: this.tokens } : null,
            signal: controller.signal,
            onEvent: (event) => this.onAgentEvent(event, messages),
        });
        // 一轮正常走完,连续接续计数清零
        if (result.status === 'completed') { this.resumes = 0; this.save(); }
    }

    onAgentEvent(event, messages) {
        switch (event.type) {
            case 'message':
                if (event.delta) { this.partial += event.delta; this.emit({ type: 'delta', text: event.delta }); return; }
                this.partial = '';
                this.push(event.item);
                return;
            case 'reasoning':
                // 思考块要存(下次请求原样带回),界面不显示;增量忽略
                if (event.item) this.push(event.item);
                return;
            case 'function_call':
            case 'function_call_output':
                this.push(event.item);
                return;
            case 'usage':
                this.tokens = Number(event.usage?.total_tokens) || 0;
                this.save();
                this.emit({ type: 'usage', tokens: this.tokens });
                return;
            case 'compact':
                if (event.status === 'started') { this.emit({ type: 'compacting' }); return; }
                this.insertCompaction(event, messages);
                return;
            case 'retry':
                this.emit({ type: 'retry', attempt: event.attempt, maxRetries: event.maxRetries, error: event.error });
                return;
            case 'error':
                this.emit({ type: 'error', message: event.error });
                return;
            case 'done':
                // 被重启打断不算用户停下,不报「已停止」
                if (event.status === 'aborted' && !this.shuttingDown) this.emit({ type: 'error', message: '已停止' });
                return;
            default:
        }
    }

    /** 标记插在被保留的第一条之前;agent 收到返回后才会替换上下文,所以这时 messages[end] 还是那一条。 */
    insertCompaction(event, messages) {
        // 被保留的第一条可能是现编的「重启完成」消息(不在 this.items 里),往后找第一条存着的
        let at = -1;
        for (let i = event.end; i < messages.length && at < 0; i += 1) at = this.items.indexOf(messages[i]);
        const marker = { type: 'compaction', summary: event.summary, item: event.item, covered: event.end - event.start, at: new Date().toISOString() };
        if (at >= 0) this.items.splice(at, 0, marker); else this.items.push(marker);
        this.tokens = 0;
        this.save();
        this.emit({ type: 'compacted' });
    }
}
