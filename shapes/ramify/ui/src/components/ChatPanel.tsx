// 左侧对话栏:和 agent 说话的地方。选中了画布上的节点,这句话就带着它作为上下文。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatRow } from '../lib/chat';
import type { TreeNode } from '../types';
import { MessageStream } from './MessageStream';
import { Mark } from './Mark';

export function ChatPanel({ title, rows, busy, hasMore, selected, width, scrollSeq, onHome, onSend, onStop, onLoadOlder, onClearSelection }: {
    title: string; rows: ChatRow[]; busy: boolean; hasMore: boolean; selected: TreeNode | null; width: number; scrollSeq: number;
    onHome: () => void; onSend: (text: string) => Promise<void>; onStop: () => void; onLoadOlder: () => Promise<void>; onClearSelection: () => void;
}) {
    const [draft, setDraft] = useState('');
    const area = useRef<HTMLTextAreaElement>(null);
    const composing = useRef(false);
    useEffect(() => { area.current?.focus(); }, [selected?.id]);
    const placeholder = useMemo(() => (selected ? (selected.type === 'text' ? '想从这里长出什么?' : '想怎么改这个方案?') : '说说你想要什么……'), [selected]);

    const submit = async () => {
        const text = draft.trim();
        if (!text || busy) return;
        setDraft('');
        if (area.current) area.current.style.height = 'auto';
        await onSend(text);
    };

    return (
        <aside className="chat-panel" style={{ width }}>
            <header className="chat-head">
                <button className="chat-home" title="回首页" onClick={onHome}><Mark size={18} /></button>
                <span className="bar-sep" />
                <strong className="chat-title" title={title}>{title}</strong>
            </header>
            <MessageStream rows={rows} busy={busy} hasMore={hasMore} onLoadOlder={onLoadOlder} scrollSeq={scrollSeq} />
            <footer className="composer-wrap">
                {selected && (
                    <div className="context-chip">
                        <span>正在讨论:<b>#{selected.seq} {selected.title}</b></span>
                        <button title="不带上下文" onClick={onClearSelection}>✕</button>
                    </div>
                )}
                <div className="composer-box">
                    <textarea ref={area} value={draft} rows={1} placeholder={placeholder}
                        onChange={(event) => { setDraft(event.target.value); const el = event.currentTarget; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }}
                        onCompositionStart={() => { composing.current = true; }}
                        onCompositionEnd={() => { composing.current = false; }}
                        onKeyDown={(event) => {
                            if (event.key !== 'Enter' || event.shiftKey || composing.current || event.nativeEvent.isComposing) return;
                            event.preventDefault();
                            void submit();
                        }} />
                    {busy
                        ? <button className="composer-action is-stop" title="停止" onClick={onStop}><i /></button>
                        : <button className="composer-action" title="发送" disabled={!draft.trim()} onClick={() => void submit()}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-5 14-2.6-5.4L5 12Z" /></svg>
                        </button>}
                </div>
            </footer>
        </aside>
    );
}
