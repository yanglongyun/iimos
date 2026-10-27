// 发散气泡:挂在节点右侧,输入修改要求 + 选数量,从这个节点长出新分支。
import { useEffect, useRef, useState } from 'react';
import type { TreeNode } from '../types';
import type { Pos } from '../lib/layout';
import { CountPicker } from './CountPicker';

export function Bubble({ node, pos, onSubmit, onClose }: {
    node: TreeNode; pos: Pos; onSubmit: (prompt: string, count: number) => void; onClose: () => void;
}) {
    const [text, setText] = useState('');
    const [count, setCount] = useState(2);
    const ref = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        const timer = setTimeout(() => ref.current?.focus(), 60);
        return () => clearTimeout(timer);
    }, [node.id]);
    const isRoot = node.parent_id === null;
    const submit = () => { if (text.trim()) onSubmit(text.trim(), count); };
    const arrowTop = 14;   // 箭头对准右上角的发散图标
    return (
        <div className="bubble" style={{ left: pos.x + pos.w / 2 + 24, top: pos.y - pos.h / 2 - 12 - arrowTop + 14, ['--arrow-top' as string]: `${arrowTop}px` }}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <div className="bubble-head">{isRoot ? '从需求再长几版' : <>从 <b>「{node.title}」</b> 继续</>}</div>
            <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={isRoot ? '换个方向试试?' : '想怎么改?'}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
                    if (e.key === 'Escape') onClose();
                }} />
            <CountPicker value={count} onChange={setCount} />
            <button className="primary bubble-submit" onClick={submit} disabled={!text.trim()}>发散 · {count}</button>
        </div>
    );
}
