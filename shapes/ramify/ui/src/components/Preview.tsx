// 右侧预览:完整网页(可以跑脚本),能看源码、复制、在新窗口打开。
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { TreeNode } from '../types';
import { isArtifact } from '../types';

const DEFAULT_WIDTH = 520, MIN_WIDTH = 320;

export function Preview({ node, onClose, onToast }: { node: TreeNode; onClose: () => void; onToast: (text: string) => void }) {
    const hasArtifact = isArtifact(node.type) && node.content !== null;
    const [width, setWidth] = useState(DEFAULT_WIDTH);
    const [source, setSource] = useState(false);
    const drag = useRef({ active: false, sx: 0, sw: 0 });
    useEffect(() => { setSource(false); }, [node.id]);

    async function copy() {
        try { await navigator.clipboard.writeText(node.content || ''); onToast('源码已复制'); }
        catch { onToast('复制失败'); }
    }
    return (
        <>
            <div className="divider"
                onPointerDown={(event) => { drag.current = { active: true, sx: event.clientX, sw: width }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); event.preventDefault(); }}
                onPointerMove={(event) => { if (drag.current.active) setWidth(Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.75, drag.current.sw + drag.current.sx - event.clientX))); }}
                onPointerUp={() => { drag.current.active = false; }} />
            <aside className="preview" style={{ width }}>
                <div className="preview-bar">
                    <span className="preview-title"><span className="node-seq">#{node.seq}</span>{node.title}</span>
                    <div className="preview-actions">
                        {hasArtifact && <>
                            <button className={source ? 'is-on' : ''} title="看源码" onClick={() => setSource((s) => !s)}>
                                <svg viewBox="0 0 24 24"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></svg>
                            </button>
                            <button title="复制源码" onClick={() => void copy()}>
                                <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                            </button>
                            <button title="在新窗口打开" onClick={() => window.open(api.nodeHtmlUrl(node.id), '_blank', 'noopener')}>
                                <svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
                            </button>
                        </>}
                        <button className="is-close" title="关闭" onClick={onClose}>
                            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
                        </button>
                    </div>
                </div>
                {source || !hasArtifact
                    ? <pre className="preview-source">{node.content || ''}</pre>
                    : <iframe key={`${node.id}:${node.updated_at}`} className="preview-frame" sandbox="allow-scripts allow-forms allow-popups allow-modals"
                        src={api.nodeHtmlUrl(node.id, node.updated_at)} title={node.title} />}
            </aside>
        </>
    );
}
