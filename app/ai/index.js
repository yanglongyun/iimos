// 模型请求:OpenAI Responses 协议,流式。只管「发一次请求、拿回完整结果」,不管循环、不管工具执行。
// 网络失败、429/5xx、断流且还没交付内容时重试两次;协议错误、模型拒绝直接抛。
import { setTimeout as delay } from 'node:timers/promises';

export const message = (text, kind = 'input_text', role = 'user') => ({
    type: 'message',
    role,
    content: [{ type: kind, text }],
});

export const outputText = (item) =>
    (Array.isArray(item.content) ? item.content : [])
        .filter((part) => part.type === 'output_text')
        .map((part) => part.text || '')
        .join('');

async function boundedBody(response, limit) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) throw new Error('响应超过大小限制');
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks);
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/** 读 SSE 流。正文 / 思考增量交给 onEvent;以 response.completed 里的完整 response 为准返回。 */
async function readStream(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let size = 0;
    let final;
    const dispatch = async (raw) => {
        const data = raw
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).replace(/^ /, ''))
            .join('\n');
        if (!data || data === '[DONE]') return;
        const event = JSON.parse(data);
        if (event.type === 'response.output_text.delta' && event.delta) {
            await onEvent?.({ type: 'message', delta: event.delta });
        }
        if ((event.type === 'response.reasoning_text.delta' || event.type === 'response.reasoning_summary_text.delta') && event.delta) {
            await onEvent?.({ type: 'reasoning', delta: event.delta });
        }
        if (event.type === 'response.incomplete') {
            const error = new Error(`模型回复未完成:${event.response?.incomplete_details?.reason || 'unknown'}`);
            error.code = 'model_incomplete';
            throw error;
        }
        if (event.type === 'response.completed') final = event.response;
        if (event.type === 'response.failed') {
            const error = new Error(event.response?.error?.message || '模型响应失败');
            error.code = event.response?.error?.code;
            throw error;
        }
        if (event.type === 'error') {
            const error = new Error(event.message || '模型响应出错');
            error.code = event.code;
            throw error;
        }
    };
    try {
        for (;;) {
            let chunk;
            try {
                chunk = await reader.read();
            } catch (cause) {
                const error = new Error(`模型流读取失败:${cause.message}`);
                error.code = 'stream_interrupted';
                throw error;
            }
            const { value, done } = chunk;
            if (done) {
                buffer += decoder.decode();
                if (buffer.trim()) await dispatch(buffer.replace(/\r\n/g, '\n'));
                break;
            }
            size += value.length;
            if (size > 64 * 1024 * 1024) throw new Error('模型流超过大小限制');
            buffer += decoder.decode(value, { stream: true });
            // 先拼接再处理换行,避免 CR 和 LF 分属两个网络片段时丢失边界
            buffer = buffer.replace(/\r\n/g, '\n');
            let index = buffer.indexOf('\n\n');
            while (index >= 0) {
                await dispatch(buffer.slice(0, index));
                buffer = buffer.slice(index + 2);
                if (final) break;
                index = buffer.indexOf('\n\n');
            }
            if (final) break;
        }
        if (!final || !Array.isArray(final.output)) {
            const error = new Error('模型流在结束前中断');
            error.code = 'stream_interrupted';
            throw error;
        }
        return final;
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/**
 * 请求一次模型,返回完整 response(含 output 与 usage)。
 * 传了 onEvent 就走流式,增量通过它交付;重试前也会发一次 { type: 'retry' }。
 * config 只用 url、key 两项;model 由调用方显式传入。
 */
export async function callModel(instructions, messages, model, config, tools = [], onEvent, signal) {
    const payload = { instructions, input: messages, model, tools, store: false };
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${config.key}` };
    if (onEvent) {
        payload.stream = true;
        headers.accept = 'text/event-stream';
    }
    const body = JSON.stringify(payload);
    let last;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        signal?.throwIfAborted();
        let delivered = false;
        let phase = 'fetch';
        let retryableHttp = false;
        try {
            const response = await fetch(config.url, { method: 'POST', signal, headers, body });
            phase = 'response';
            if (!response.ok) {
                retryableHttp = response.status === 429 || response.status >= 500;
                const raw = (await boundedBody(response, 16 * 1024 * 1024)).toString();
                let text;
                try { text = JSON.parse(raw).error?.message; } catch { /* 代理可能返回纯文本错误 */ }
                const error = new Error(`模型服务 HTTP ${response.status}:${text || raw.slice(0, 300)}`);
                error.code = `http_${response.status}`;
                throw error;
            }
            let result;
            if (onEvent) {
                if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
                    const error = new Error('流式请求必须返回 text/event-stream');
                    error.code = 'invalid_response';
                    throw error;
                }
                result = await readStream(response, async (event) => {
                    delivered = true;
                    await onEvent(event);
                });
            } else {
                result = JSON.parse((await boundedBody(response, 16 * 1024 * 1024)).toString());
            }
            if (result.error || (result.status && result.status !== 'completed') || !Array.isArray(result.output)) {
                const error = new Error(result.error?.message || '模型返回的 output 无效或未完整生成');
                error.code = result.error?.code || (result.status === 'incomplete' ? 'model_incomplete' : 'invalid_response');
                throw error;
            }
            return result;
        } catch (error) {
            signal?.throwIfAborted();
            // 只有还没交付内容的网络失败、断流和 429/5xx 可以重试;协议错误、模型拒绝、回调出错直接终止
            const retryable = phase === 'fetch' || retryableHttp || error.code === 'stream_interrupted';
            if (delivered || !retryable) throw error;
            last = error;
            if (attempt < 2) {
                const delayMs = (attempt + 1) * 2000;
                await onEvent?.({ type: 'retry', attempt: attempt + 1, maxRetries: 2, delayMs, error: error.message });
                await delay(delayMs, undefined, { signal });
            }
        }
    }
    throw last;
}
