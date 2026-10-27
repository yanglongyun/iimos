// 连续的工具调用折成一组,每行一句话,点开看输入输出。
import { useState } from 'react';
import type { ToolRow } from '../lib/chat';

const LABELS: Record<string, string> = { add_nodes: '新建占位', write_node: '写入作品', read_tree: '读取树', shell: '执行命令' };

function parse(value: string): Record<string, unknown> {
    try { const v = JSON.parse(value); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function line(row: ToolRow): string {
    const args = parse(row.arguments);
    const label = LABELS[row.name] || row.name;
    if (row.name === 'write_node') return `${label} · ${String(args.title || args.id || '')}${args.type === 'error' ? '(标记失败)' : ''}`;
    if (row.name === 'add_nodes') return `${label} · ${String(args.count || '')} 个${args.round ? ` · ${String(args.round).slice(0, 30)}` : ''}`;
    if (row.name === 'shell') return `${label} · ${String(args.command || '').slice(0, 80)}`;
    return label;
}
function pretty(value: string): string {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

export function ToolGroup({ items, onBeforeExpand }: { items: ToolRow[]; onBeforeExpand: () => void }) {
    const [open, setOpen] = useState<Set<string>>(() => new Set());
    return (
        <div className="tool-trace">
            {items.map((row) => {
                const expanded = open.has(row.key);
                const state = row.result === null ? 'running' : row.failed ? 'failed' : 'done';
                return (
                    <div key={row.key} className={`trace-row is-${state}${expanded ? ' is-open' : ''}`}>
                        <button className="trace-line" onClick={() => { if (!expanded) onBeforeExpand(); setOpen((s) => { const n = new Set(s); n.has(row.key) ? n.delete(row.key) : n.add(row.key); return n; }); }}>
                            <i className="trace-dot" /><span className="trace-text">{line(row)}</span>{row.failed && <em className="trace-flag">失败</em>}
                        </button>
                        {expanded && (
                            <div className="trace-detail">
                                <b>输入</b><pre>{pretty(row.arguments)}</pre>
                                {row.result !== null && <><b>输出</b><pre>{row.result}</pre></>}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
