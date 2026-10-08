// 对话就是一份执行日志:用户一行「› …」、工具一行缩进(点开看输出)、回复一段。
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

export function Log({ items, partial, running }: { items: Item[]; partial: string; running: boolean }) {
    const outputs = new Map<string, string>();
    for (const item of items) if (item.type === 'function_call_output') outputs.set(item.call_id, item.output);
    return (
        <section className="log">
            <div id="items">
                {items.map((item, i) => {
                    switch (item.type) {
                        case 'message':
                            if (item.role === 'user') return <p key={i} className="u">{textOf(item)}</p>;
                            return textOf(item).trim() ? <div key={i} className="a" dangerouslySetInnerHTML={{ __html: markdown(textOf(item)) }} /> : null;
                        case 'function_call':
                            return <Tool key={i} name={item.name} args={item.arguments} output={outputs.get(item.call_id)} />;
                        case 'compaction':
                            return (
                                <details key={i} className="cmp">
                                    <summary>已压缩 {item.covered} 条 · 点开看摘要</summary>
                                    <pre>{item.summary}</pre>
                                </details>
                            );
                        case 'restart':
                            return <p key={i} className="restarted">{item.stopped ? '已重启 · 连续重启太多次,先停在这里' : '已重启 · 接着刚才的继续'}</p>;
                        case 'local':
                            if (item.kind === 'compacting') return <details key={i} className="cmp pending"><summary>{item.text}</summary></details>;
                            return <p key={i} className={{ error: 'err', stopped: 'note', retry: 'retry' }[item.kind]}>{item.text}</p>;
                        default:
                            return null;   // reasoning、工具结果(并进调用那一行)不单独显示
                    }
                })}
            </div>
            {running && <div className="a live" dangerouslySetInnerHTML={{ __html: markdown(partial) }} />}
        </section>
    );
}
