// 画布:整棵树、节点卡片、发散气泡、右侧预览。
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { Id, TreeNode } from '../types';
import { isArtifact } from '../types';
import { edgePath, layoutTree } from '../lib/layout';
import { useViewport } from '../lib/viewport';
import { NodeCard } from './NodeCard';
import { Bubble } from './Bubble';
import { Preview } from './Preview';
import { Minimap } from './Minimap';
import { Mark } from './Mark';

const RENDER_OVERSCAN_PX = 700;
const PREVIEW_MIN_ZOOM = 0.3;
// 同时挂载的缩略图上限:每张都是一个完整网页,按离视野中心的距离取前 N 张,其余留骨架
const THUMB_BUDGET = 10;

function intersects(p: { x: number; y: number; w: number; h: number }, rect: { x1: number; y1: number; x2: number; y2: number }) {
    return p.x + p.w / 2 >= rect.x1 && p.x - p.w / 2 <= rect.x2 && p.y + p.h / 2 >= rect.y1 && p.y - p.h / 2 <= rect.y2;
}

// memo:对话每来一个增量 App 都会重渲染,树和缩略图不该跟着动
export const Canvas = memo(function Canvas({ nodes, title, prompt, selectedId, setSelectedId, ready, onBranch, onSetup, onToast }: {
    nodes: TreeNode[]; title: string; prompt: string;
    selectedId: Id | null; setSelectedId: (id: Id | null) => void;
    ready: boolean;
    onBranch: (nodeId: Id, prompt: string, count: number) => Promise<void>;
    onSetup: () => void;
    onToast: (text: string) => void;
}) {
    const [previewId, setPreviewId] = useState<Id | null>(null);
    const [bubbleOpen, setBubbleOpen] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<Id>>(() => new Set());

    const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const childrenMap = useMemo(() => {
        const children = new Map<Id, Id[]>();
        for (const node of nodes) {
            if (!node.parent_id) continue;
            if (!children.has(node.parent_id)) children.set(node.parent_id, []);
            children.get(node.parent_id)!.push(node.id);
        }
        return children;
    }, [nodes]);
    const visibleNodes = useMemo(() => {
        const root = nodes.find((node) => node.parent_id === null);
        if (!root) return [] as TreeNode[];
        const visible: TreeNode[] = [];
        const walk = (id: Id) => {
            const node = byId.get(id);
            if (!node) return;
            visible.push(node);
            if (!collapsed.has(id)) (childrenMap.get(id) ?? []).forEach(walk);
        };
        walk(root.id);
        return visible;
    }, [nodes, byId, collapsed, childrenMap]);
    const descendantCount = useCallback((id: Id): number => {
        const children = childrenMap.get(id) ?? [];
        return children.length + children.reduce((sum, child) => sum + descendantCount(child), 0);
    }, [childrenMap]);

    const positions = useMemo(() => layoutTree(visibleNodes), [visibleNodes]);
    const clearSelection = useCallback(() => { setSelectedId(null); setBubbleOpen(false); }, []);
    const viewport = useViewport(positions, clearSelection);

    const renderRect = useMemo(() => {
        const pad = RENDER_OVERSCAN_PX / viewport.view.k;
        return {
            x1: -viewport.view.x / viewport.view.k - pad,
            y1: -viewport.view.y / viewport.view.k - pad,
            x2: (viewport.canvasSize.w - viewport.view.x) / viewport.view.k + pad,
            y2: (viewport.canvasSize.h - viewport.view.y) / viewport.view.k + pad,
        };
    }, [viewport.view, viewport.canvasSize]);
    const renderNodes = useMemo(() => visibleNodes.filter((node) => {
        const position = positions.get(node.id);
        return position ? intersects(position, renderRect) : false;
    }), [visibleNodes, positions, renderRect]);
    const renderIds = useMemo(() => new Set(renderNodes.map((node) => node.id)), [renderNodes]);
    const thumbIds = useMemo(() => {
        if (viewport.view.k < PREVIEW_MIN_ZOOM) return new Set<Id>();
        const cx = (renderRect.x1 + renderRect.x2) / 2, cy = (renderRect.y1 + renderRect.y2) / 2;
        return new Set(renderNodes
            .filter((node) => isArtifact(node.type) && node.content !== null)
            .map((node) => { const p = positions.get(node.id)!; return { id: node.id, d: (p.x - cx) ** 2 + (p.y - cy) ** 2 }; })
            .sort((a, b) => a.d - b.d).slice(0, THUMB_BUDGET).map((entry) => entry.id));
    }, [renderNodes, positions, renderRect, viewport.view.k]);

    useEffect(() => { if (selectedId && !positions.has(selectedId)) setSelectedId(null); }, [positions, selectedId]);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            if (bubbleOpen) setBubbleOpen(false);
            else if (previewId) setPreviewId(null);
            else setSelectedId(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [previewId, bubbleOpen]);

    const highlighted = useMemo(() => {
        const edges = new Set<Id>();
        let current = selectedId ? byId.get(selectedId) : undefined;
        while (current?.parent_id) { edges.add(current.id); current = byId.get(current.parent_id); }
        return edges;
    }, [selectedId, byId]);

    function onNodeClick(id: Id) {
        const node = byId.get(id);
        if (!node) return;
        setSelectedId(id);
        if (node.type === 'text') { setPreviewId(null); setBubbleOpen(true); return; }
        setBubbleOpen(false);
        if (isArtifact(node.type) && node.content === null) { setPreviewId(null); onToast('还在生成,稍等'); return; }
        setPreviewId(id);
    }
    function onNodeBranch(id: Id) { setSelectedId(id); setBubbleOpen(true); }
    function toggleCollapse(id: Id) {
        setCollapsed((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
    }
    async function submitBranch(prompt: string, count: number) {
        if (!selectedId) return;
        if (!ready) { onSetup(); return; }
        setBubbleOpen(false);
        try { await onBranch(selectedId, prompt, count); }
        catch (error) { onToast(error instanceof Error ? error.message : String(error)); }
    }

    const done = nodes.filter((node) => isArtifact(node.type) && node.content !== null).length;
    const generating = nodes.filter((node) => isArtifact(node.type) && node.content === null).length;
    const previewNode = previewId ? byId.get(previewId) : undefined;

    return (
        <div className="canvas-pane">
            <div className="bar">
                <Mark size={15} />
                <div className="bar-name" title={prompt}>{title}</div>
                <span className="bar-stat"><b>{done}</b> 版</span>
                {generating > 0 && <span className="bar-stat is-live"><b>{generating}</b> 生成中</span>}
                <button className="bar-model" title="模型配置" onClick={onSetup}><span className={ready ? 'on' : ''} /></button>
            </div>
            <div className="canvas-layout">
                <div ref={viewport.viewportRef} className="viewport" onPointerDown={viewport.onPointerDown} onPointerMove={viewport.onPointerMove} onPointerUp={viewport.onPointerUp}>
                    <div className="world" style={{ transform: `translate(${viewport.view.x}px, ${viewport.view.y}px) scale(${viewport.view.k})` }}>
                        <svg className="edges">{visibleNodes.map((node) => {
                            if (!node.parent_id) return null;
                            const parent = positions.get(node.parent_id), child = positions.get(node.id);
                            if (!parent || !child || (!renderIds.has(node.parent_id) && !renderIds.has(node.id))) return null;
                            return <path key={node.id} className={`edge${highlighted.has(node.id) ? ' is-highlighted' : ''}`} d={edgePath(parent, child)} />;
                        })}</svg>
                        {renderNodes.map((node) => {
                            const position = positions.get(node.id);
                            if (!position) return null;
                            return <NodeCard key={node.id} node={node} pos={position} selected={node.id === selectedId}
                                collapsed={collapsed.has(node.id)} hiddenCount={collapsed.has(node.id) ? descendantCount(node.id) : 0}
                                hasChildren={(childrenMap.get(node.id) ?? []).length > 0} renderPreview={thumbIds.has(node.id)}
                                onClick={onNodeClick} onBranch={onNodeBranch} onToggle={toggleCollapse} />;
                        })}
                        {bubbleOpen && selectedId && byId.get(selectedId) && positions.get(selectedId) && (
                            <Bubble key={selectedId} node={byId.get(selectedId)!} pos={positions.get(selectedId)!} onSubmit={submitBranch} onClose={() => setBubbleOpen(false)} />
                        )}
                    </div>
                    <div className="zoom">
                        <button onClick={() => viewport.zoomAt(viewport.canvasSize.w / 2, viewport.canvasSize.h / 2, viewport.view.k / 1.25)}>−</button>
                        <span className="zoom-value">{Math.round(viewport.view.k * 100)}%</span>
                        <button onClick={() => viewport.zoomAt(viewport.canvasSize.w / 2, viewport.canvasSize.h / 2, viewport.view.k * 1.25)}>＋</button>
                        <button className="zoom-fit" onClick={viewport.fitView}>适应</button>
                    </div>
                    <Minimap nodes={visibleNodes} positions={positions} view={viewport.view} canvasSize={viewport.canvasSize}
                        onNavigate={(x, y) => viewport.setView((current) => ({ ...current, x: viewport.canvasSize.w / 2 - x * current.k, y: viewport.canvasSize.h / 2 - y * current.k }))} />
                    <div className="canvas-hint">拖动平移 · 滚轮平移 · ⌘/Ctrl + 滚轮缩放 · 点节点预览,再在左边说话 · 点枝叶直接分叉</div>
                </div>
                {previewNode && <Preview node={previewNode} onClose={() => setPreviewId(null)} onToast={onToast} />}
            </div>
        </div>
    );
});
