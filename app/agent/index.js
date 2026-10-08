// agent 循环:接收上下文,执行模型、压缩和工具循环,通过 onEvent 输出九种运行事件。
// 结构照 agentic/app/server/agent:模型请求在 ../ai,工具定义在 tools.js,执行在 runner.js + functions/。
//
// 九种事件(都带 type):
//   message              { delta } 正文增量,或 { item } 完整消息
//   reasoning            { delta } 思考增量,或 { item } 完整思考块
//   function_call        { item } 完整的工具调用
//   function_call_output { item } 工具结果
//   retry                { attempt, maxRetries, delayMs, error } 请求即将重试
//   usage                { usage } 这次模型请求的实际用量
//   compact              { status: 'started' } / { status: 'completed', item, summary, start, end }
//   error                { code, error } 终止性错误
//   done                 { status: completed | incomplete | aborted, stopReason? } 最后发一次
//
// 指令(instructions)由调用方准备好,这里原样透传。messages 由调用方持有,本次循环直接往里追加,
// 压缩时替换掉被压缩的那段 —— 调用方在 onEvent 里保存,保存完 agent 才继续。
import { callModel, outputText } from '../ai/index.js';
import tools from './tools.js';
import runTool from './runner.js';
import compact from './compact.js';

export async function run({ instructions, messages, model, config, usage = null, signal, onEvent = () => {} }) {
    let tokens = null;
    let text = '';
    let status = 'completed';
    let stopReason;
    let stage = 'model';
    let failure;
    try {
        while (true) {
            signal?.throwIfAborted();

            if (Number.isFinite(usage?.total_tokens) && usage.total_tokens >= config.compact_at) {
                stage = 'compact';
                const compressed = await compact(messages, model, config, signal, onEvent);
                if (compressed) {
                    // 调用方保存摘要成功后,才替换上下文并继续请求
                    await onEvent({ type: 'compact', status: 'completed', ...compressed });
                    messages.splice(compressed.start, compressed.end - compressed.start, compressed.item);
                    usage = null;
                }
            }

            stage = 'model';
            const response = await callModel(instructions, messages, model, config, tools, onEvent, signal);
            signal?.throwIfAborted();
            // 先确认整份输出有效,再交付完整块、执行工具
            for (const item of response.output) {
                if (!['message', 'reasoning', 'function_call'].includes(item.type)) throw new Error(`不支持的模型输出类型:${item.type}`);
                if (item.type === 'function_call' && (typeof item.call_id !== 'string' || !item.call_id)) throw new Error('模型工具调用缺少 call_id');
            }
            const calls = [];
            // 模型完整输出原样追加,作为下一次请求的上下文
            for (const item of response.output) {
                messages.push(item);
                await onEvent({ type: item.type, item });
                if (item.type === 'message') text += outputText(item);
                if (item.type === 'function_call') calls.push(item);
            }
            usage = response.usage || null;
            tokens = Number.isFinite(usage?.total_tokens) && usage.total_tokens >= 0 ? usage.total_tokens : null;
            await onEvent({ type: 'usage', usage });
            signal?.throwIfAborted();
            if (!calls.length) break;

            stage = 'tool';
            for (const call of calls) {
                signal?.throwIfAborted();
                const output = await runTool(call, config, signal);
                signal?.throwIfAborted();
                const item = {
                    type: 'function_call_output',
                    call_id: call.call_id,
                    output: JSON.stringify({ success: !output.failed, text: output.text }),
                };
                messages.push(item);
                await onEvent({ type: 'function_call_output', item });
            }
        }
    } catch (error) {
        if (signal?.aborted && signal.reason?.name !== 'TimeoutError') {
            status = 'aborted';
            stopReason = 'aborted';
        } else {
            status = 'incomplete';
            let code = error.code || `${stage}_error`;
            if (signal?.reason?.name === 'TimeoutError' || error.name === 'TimeoutError') code = 'timeout';
            stopReason = error.stopReason || code;
            failure = { type: 'error', code, error: error.message };
        }
    }
    // 终止事件也必须交付,不因 signal 已取消而跳过
    try {
        if (failure) await onEvent(failure);
    } finally {
        const done = { type: 'done', status };
        if (stopReason) done.stopReason = stopReason;
        await onEvent(done);
    }
    return { text, tokens, status, stopReason };
}
