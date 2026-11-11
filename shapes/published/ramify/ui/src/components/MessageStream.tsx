// 消息流:用户气泡、agent 的 Markdown 回复、工具调用组、压缩标记、本地提示。贴着底部跟随,往上翻时不打扰,滚到顶加载更早。
import { memo, useEffect, useMemo, useRef } from 'react';
import type { ChatRow, ToolRow } from '../lib/chat';
import { renderMarkdown } from '../lib/markdown';
import { Mark } from './Mark';
import { ToolGroup } from './ToolGroup';

type Block = { kind: 'tools'; key: string; items: ToolRow[] } | { kind: 'row'; key: string; row: Exclude<ChatRow, ToolRow> };

export function MessageStream({ rows, busy, hasMore, onLoadOlder, scrollSeq }: {
    rows: ChatRow[]; busy: boolean; hasMore: boolean; onLoadOlder: () => Promise<void>; scrollSeq: number;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const stick = useRef(true);
    const restoreHeight = useRef(0);
    const keepTop = useRef<number | null>(null);
    const loading = useRef(false);
    const blocks = useMemo(() => {
        const out: Block[] = [];
        for (const row of rows) {
            if (row.kind === 'tool') {
                const last = out[out.length - 1];
                if (last?.kind === 'tools') last.items.push(row); else out.push({ kind: 'tools', key: `g${row.key}`, items: [row] });
            } else out.push({ kind: 'row', key: row.key, row });
        }
        return out;
    }, [rows]);
    const last = rows[rows.length - 1];
    const typing = busy && !(last?.kind === 'assistant' && last.streaming);

    useEffect(() => {
        const inner = innerRef.current;
        if (!inner) return;
        const observer = new ResizeObserver(() => {
            const el = scrollRef.current;
            if (!el) return;
            if (keepTop.current !== null) { el.scrollTop = keepTop.current; keepTop.current = null; }
            else if (restoreHeight.current > 0) { el.scrollTop = el.scrollHeight - restoreHeight.current; restoreHeight.current = 0; }
            else if (stick.current) el.scrollTop = el.scrollHeight;
        });
        observer.observe(inner);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        stick.current = true;
        requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; });
    }, [scrollSeq]);

    return (
        <div className="message-stream" ref={scrollRef} onScroll={(event) => {
            const el = event.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (el.scrollTop < 60 && hasMore && !loading.current) {
                loading.current = true;
                restoreHeight.current = el.scrollHeight;
                void onLoadOlder().finally(() => { loading.current = false; });
            }
        }}>
            <div className="message-stream-inner" ref={innerRef}>
                {hasMore && <span className="history-status">↑ 上滑加载更早</span>}
                {blocks.length === 0 && !busy && (
                    <div className="chat-empty"><Mark size={30} /><strong>从一句话开始</strong><span>描述想法,agent 会直接在画布上长出方案。</span></div>
                )}
                {blocks.map((block) => {
                    if (block.kind === 'tools') {
                        return <ToolGroup key={block.key} items={block.items} onBeforeExpand={() => { const el = scrollRef.current; if (el) { keepTop.current = el.scrollTop; stick.current = false; } }} />;
                    }
                    const { row } = block;
                    if (row.kind === 'user') {
                        return (
                            <div className="user-message" key={row.key}>
                                {row.node && (row.node.id || row.node.count) && (
                                    <span className="user-context">{row.node.title ? `从「${row.node.title}」继续` : '新画布'}{row.node.count ? ` · ${row.node.count} 版` : ''}</span>
                                )}
                                <div>{row.content}</div>
                            </div>
                        );
                    }
                    if (row.kind === 'assistant') return <Assistant key={row.key} content={row.content} streaming={row.streaming} />;
                    if (row.kind === 'compaction') return <span className="chat-divider" key={row.key} title={row.summary}>之前的对话已压缩成摘要</span>;
                    return <span className={`chat-note is-${row.note}`} key={row.key}>{row.content}</span>;
                })}
                {typing && (
                    <div className="assistant-message typing-message"><span className="assistant-avatar"><Mark size={16} /></span><div><span className="typing-dots"><i /><i /><i /></span></div></div>
                )}
            </div>
        </div>
    );
}

// 每条回复的 Markdown 只在它自己的内容变了才重新渲染(流式时只有最后一条在变)
const Assistant = memo(function Assistant({ content, streaming }: { content: string; streaming: boolean }) {
    const html = useMemo(() => renderMarkdown(content), [content]);
    return (
        <div className={`assistant-message${streaming ? ' is-streaming' : ''}`}>
            <span className="assistant-avatar"><Mark size={16} /></span>
            <div className="assistant-content chat-markdown" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    );
});
