// 导图工作区:参考 mindmap 应用的 SVG 画布引擎 + 本形态的对话/数据底座。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api';
import { saveAdapter, toEngine } from '../mindmap/adapter';
import { Outline } from '../mindmap/Outline';
import { Toolbar } from '../mindmap/Toolbar';
import { useMindmapEngine } from '../mindmap/useMindmapEngine';
import type { Topic as ApiTopic } from '../types';

export function MindCanvas({ projectId, title, nodes, selectedId, onSelect, onBack, onSetup, ready }: {
    projectId: string;
    title: string;
    nodes: ApiTopic[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onBack: () => void;
    onSetup: () => void;
    ready: boolean;
}) {
    const [name, setName] = useState(title);
    const [draftName, setDraftName] = useState(title);
    const [mode, setMode] = useState<'canvas' | 'outline'>('canvas');
    const [toast, setToast] = useState('');
    const toastTimer = useRef(0);

    const topics = useMemo(() => nodes.map(toEngine), [nodes]);
    const notify = useCallback((message: string) => {
        setToast(message);
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(''), 3000);
    }, []);

    useEffect(() => { setName(title); setDraftName(title); }, [title]);

    const { refs, engine, zoom, count, selected, canRemove } = useMindmapEngine(projectId, topics, notify, onSelect, mode === 'canvas');

    // 对话里清掉上下文时,画布也取消选中。初始的 null 不能清,否则引擎刚选中的根会被抹掉。
    const previousSelection = useRef<string | null>(selectedId);
    useEffect(() => {
        if (selectedId === null && previousSelection.current !== null) engine.current?.select(null);
        previousSelection.current = selectedId;
    }, [selectedId, engine]);

    async function commitName() {
        const next = draftName.trim();
        if (!next) { setDraftName(name); return; }
        if (next === name) return;
        try {
            await api.renameProject(projectId, next);
            setName(next);
        } catch (error) {
            setDraftName(name);
            notify(error instanceof Error ? error.message : String(error));
        }
    }

    async function patchOutline(id: string, patch: Partial<{ text: string; collapsed: boolean }>) {
        await saveAdapter(projectId).patch(id, patch);
    }

    return (
        <div className="canvas-pane">
            <div className="board-bar">
                <button type="button" className="icon-btn" title="回到首页" onClick={onBack}>‹</button>
                <input
                    className="board-title"
                    maxLength={120}
                    title="改名"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => { void commitName(); }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') { setDraftName(name); event.currentTarget.blur(); }
                    }}
                />
                <span className="grow" />
                <span className="meta muted">{count ? `${count} 个主题` : ''}</span>
                <div className="view-switch" role="group" aria-label="查看方式">
                    <button type="button" className={mode === 'canvas' ? 'active' : ''} onClick={() => setMode('canvas')}>画布</button>
                    <button type="button" className={mode === 'outline' ? 'active' : ''} onClick={() => setMode('outline')}>大纲</button>
                </div>
                <button className="bar-model" title="模型配置" onClick={onSetup}><span className={ready ? 'on' : ''} /></button>
            </div>

            <div className={`mind-grid${mode === 'canvas' ? '' : ' view-hidden'}`} ref={refs.viewport} tabIndex={mode === 'canvas' ? 0 : -1} aria-hidden={mode !== 'canvas'}>
                <div className="mind-world" ref={refs.world}>
                    <svg xmlns="http://www.w3.org/2000/svg" ref={refs.svg} />
                </div>
                <Toolbar
                    zoom={zoom}
                    canEdit={selected !== null}
                    canRemove={canRemove}
                    on={{
                        addChild: () => engine.current?.addChild(),
                        addSibling: () => engine.current?.addSibling(),
                        remove: () => engine.current?.removeSelected(),
                        zoomOut: () => engine.current?.zoomBy(1 / 1.18),
                        zoomIn: () => engine.current?.zoomBy(1.18),
                        reset: () => engine.current?.reset(),
                        fit: () => engine.current?.fit(),
                    }}
                />
                {toast ? <div className="mind-toast">{toast}</div> : null}
            </div>
            {mode === 'outline' && <Outline topics={topics} onPatch={patchOutline} />}
        </div>
    );
}
