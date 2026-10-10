// 对话就是一份执行日志:用户一行「› …」、工具一行缩进(点开看输出)、回复一段。
// 连续对同一目标的工具调用(同名同参数摘要)聚合成一行 ×N,次数原地增长;单条仍可点开看输出。
import type { Item } from '../types';
import { markdown } from '../markdown';

const textOf = (item: { content: { text?: string }[] }) => item.content.map((part) => part.text || '').join('');

function summarize(name: string, raw: string) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(raw || '{}'); } catch { /* 原样显示 */ }
    if (name === 'shell') return String(args.command || '');
    if (name === 'read' || name === 'write' || name === 'edit') return String(args.path || '');
    return raw;
}

/** 工具结果是 { success, text } 的 JSON;读不出来就原样显示。 */
function parseOutput(output: string) {
    try {
        const parsed = JSON.parse(output);
        if (parsed && typeof parsed === 'object') return { success: parsed.success !== false, text: String(parsed.text ?? '') };
    } catch { /* 原样 */ }
    return { success: true, text: output };
}

function Tool({ name, args, output }: { name: string; args: string; output?: string }) {
    const result = output === undefined ? null : parseOutput(output);
    const className = `t${result ? '' : ' pending'}${result && !result.success ? ' failed' : ''}`;
    return (
        <details className={className}>
            <summary><b>{name}</b>{summarize(name, args).split('\n')[0]}</summary>
            {/* 命令输出末尾自带换行,再接「[退出码]」前的空行就成了两行空白,收成一行 */}
            {result && <pre>{result.text.replace(/\n{3,}/g, '\n\n')}</pre>}
        </details>
    );
}

type Call = Extract<Item, { type: 'function_call' }>;
const callKey = (item: Call) => `${item.name}\n${summarize(item.name, item.arguments)}`;

export function Log({ items, partial, running }: { items: Item[]; partial: string; running: boolean }) {
    const outputs = new Map<string, string>();
    for (const item of items) if (item.type === 'function_call_output') outputs.set(item.call_id, item.output);

    // 先把连续同类调用收拢成组、其余条目原样占位,再渲染。
    // 组以首次出现的位置为 key,新调用进来只涨次数,行原地不动。
    type Unit = { item: Item; index: number } | { calls: { item: Call; index: number }[] };
    const units: Unit[] = [];
    items.forEach((item, index) => {
        // 工具结果与 reasoning 不渲染,也不该打断分组 —— 否则每次调用都会被自己的输出隔开
        if (item.type === 'function_call_output' || item.type === 'reasoning') return;
        if (item.type !== 'function_call') { units.push({ item, index }); return; }
        const last = units[units.length - 1];
        if (last && 'calls' in last && callKey(last.calls[last.calls.length - 1].item) === callKey(item)) {
            last.calls.push({ item, index });
        } else {
            units.push({ calls: [{ item, index }] });
        }
    });

    return (
        <section className="log">
            <div id="items">
                {units.map((unit) => {
                    if ('calls' in unit) {
                        const calls = unit.calls;
                        const first = calls[0];
                        if (calls.length === 1) {
                            return <Tool key={first.index} name={first.item.name} args={first.item.arguments} output={outputs.get(first.item.call_id)} />;
                        }
                        // 聚合行:×N 原地增长;有失败要露出红,不能被收进计数里
                        const failed = calls.some(({ item }) => {
                            const output = outputs.get(item.call_id);
                            return output !== undefined && !parseOutput(output).success;
                        });
                        const pending = !outputs.has(calls[calls.length - 1].item.call_id);
                        return (
                            <details key={first.index} className={`t${pending ? ' pending' : ''}${failed ? ' failed' : ''}`}>
                                <summary>
                                    <b>{first.item.name}</b>{summarize(first.item.name, first.item.arguments).split('\n')[0]}
                                    <span className="n">×{calls.length}</span>
                                </summary>
                            </details>
                        );
                    }
                    const { item, index } = unit;
                    switch (item.type) {
                        case 'message':
                            if (item.role === 'user') return <p key={index} className="u">{textOf(item)}</p>;
                            return textOf(item).trim() ? <div key={index} className="a" dangerouslySetInnerHTML={{ __html: markdown(textOf(item)) }} /> : null;
                        case 'compaction':
                            return (
                                <details key={index} className="cmp">
                                    <summary>已压缩 {item.covered} 条 · 点开看摘要</summary>
                                    <pre>{item.summary}</pre>
                                </details>
                            );
                        case 'restart':
                            return <p key={index} className="restarted">{item.stopped ? '已重启 · 连续重启太多次,先停在这里' : '已重启 · 接着刚才的继续'}</p>;
                        case 'local':
                            if (item.kind === 'compacting') return <details key={index} className="cmp pending"><summary>{item.text}</summary></details>;
                            return <p key={index} className={{ error: 'err', stopped: 'note', retry: 'retry' }[item.kind]}>{item.text}</p>;
                        default:
                            return null;   // reasoning、工具结果(并进调用那一行)不单独显示
                    }
                })}
            </div>
            {running && <div className="a live" dangerouslySetInnerHTML={{ __html: markdown(partial) }} />}
        </section>
    );
}
