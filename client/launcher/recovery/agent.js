// 救援对话里的 agent。和应用里那个完全独立:应用被改坏了,这一个还得能用。
//
// 只有一个工具 bash,工作目录就是 workspace。凭据读 <data>/config.json
// (和应用读的是同一份,契约里写死了这个位置),所以用户不用为了救援再配一次模型。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_ROUNDS = 40;
const OUTPUT_MAX = 30_000;

export function readCreds(dataDir) {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
        return config.responsesUrl && config.apiKey && config.model ? config : null;
    } catch { return null; }
}

const BASH = {
    type: 'function',
    name: 'bash',
    description: '在 workspace 里执行 bash 命令。iimos、node 两条命令可用。',
    parameters: {
        type: 'object',
        properties: { command: { type: 'string' }, timeout_ms: { type: 'integer', minimum: 1000, maximum: 600000 } },
        required: ['command'],
        additionalProperties: false,
    },
};

function runBash(command, { cwd, env, timeoutMs = 60_000, signal }) {
    return new Promise((resolve) => {
        const shell = process.platform === 'win32' ? 'bash' : '/bin/bash';
        const child = spawn(shell, ['--noprofile', '--norc', '-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const take = (chunk) => { output = (output + chunk).slice(-OUTPUT_MAX); };
        child.stdout.on('data', take);
        child.stderr.on('data', take);
        const stop = () => { try { child.kill('SIGTERM'); } catch { /* 已退出 */ } };
        const timer = setTimeout(stop, timeoutMs);
        signal?.addEventListener('abort', stop, { once: true });
        child.on('error', (error) => { clearTimeout(timer); resolve(`启动失败:${error.message}`); });
        child.on('close', (code) => { clearTimeout(timer); resolve(`exit ${code}\n${output}`); });
    });
}

async function respond({ creds, instructions, input, signal, onDelta }) {
    const response = await fetch(creds.responsesUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.apiKey}` },
        body: JSON.stringify({ model: creds.model, instructions, input, tools: [BASH], stream: true }),
        signal,
    });
    if (!response.ok) throw new Error(`模型服务 ${response.status}:${(await response.text()).slice(0, 500)}`);
    const items = [];
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            let event;
            try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
            if (event.type === 'response.output_text.delta') onDelta(String(event.delta || ''));
            else if (event.type === 'response.output_item.done' && event.item) items.push(event.item);
            else if (event.type === 'response.failed') throw new Error(event.response?.error?.message || '模型响应失败');
        }
    }
    return items;
}

/**
 * 一次救援会话。history 由调用方持有,跨多轮对话累积。
 * emit(type, data):text(增量)/ tool(命令)/ result(输出)/ done / error
 */
export async function runRescue({ history, text, workspace, dataDir, env, instructions, signal, emit }) {
    const creds = readCreds(dataDir);
    if (!creds) throw new Error('没找到模型配置。救援对话用的是你在应用里填过的服务地址 / API Key / 模型;还没填过的话,只能先用左边的回滚。');
    history.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const items = await respond({ creds, instructions, input: history, signal, onDelta: (d) => emit('text', d) });
        // 网关要求回传的东西原样回传;id/status 是上一轮的产物,不回传
        for (const { id, status, ...item } of items) history.push(item);
        const calls = items.filter((item) => item.type === 'function_call');
        if (!calls.length) { emit('done'); return; }
        for (const call of calls) {
            let args = {};
            try { args = JSON.parse(call.arguments || '{}'); } catch { /* 空参数 */ }
            emit('tool', args.command || '');
            const output = await runBash(String(args.command || ''), { cwd: workspace, env, timeoutMs: args.timeout_ms, signal });
            emit('result', output);
            history.push({ type: 'function_call_output', call_id: call.call_id, output });
        }
    }
    emit('error', `超过 ${MAX_ROUNDS} 轮,先停下`);
}
