// 树上的节点:标题节点是一枚胶囊(根 = 需求,轮 = 修改要求);作品节点是一张带缩略图的卡。
import { memo } from 'react';
import { api } from '../api';
import type { Id, TreeNode } from '../types';
import { isArtifact } from '../types';
import type { Pos } from '../lib/layout';
import { BranchIcon, Mark } from './Mark';
import { plantOf } from '../lib/plants';

type Props = {
    node: TreeNode;
    pos: Pos;
    selected: boolean;
    collapsed: boolean;
    hiddenCount: number;
    hasChildren: boolean;
    renderPreview: boolean;
    onClick: (id: Id) => void;
    onBranch: (id: Id) => void;
    onToggle: (id: Id) => void;
};

export const NodeCard = memo(function NodeCard({ node, pos, selected, collapsed, hiddenCount, hasChildren, renderPreview, onClick, onBranch, onToggle }: Props) {
    const isRoot = node.parent_id === null;
    const working = isArtifact(node.type) && node.content === null;
    const hasArtifact = isArtifact(node.type) && node.content !== null;
    const style = { transform: `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)` };
    const collapse = hasChildren && (
        <button className={`node-collapse${collapsed ? ' is-collapsed' : ''}`} title={collapsed ? `展开 ${hiddenCount} 个` : '收起'}
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}>{collapsed ? hiddenCount : '−'}</button>
    );

    if (node.type === 'text') {
        return (
            <div className={`node node-pill${selected ? ' is-selected' : ''}`} style={style} onClick={(e) => { e.stopPropagation(); onClick(node.id); }}>
                <button className="node-branch" title={isRoot ? '从需求再长几版' : `从「${node.title}」继续`} onClick={(e) => { e.stopPropagation(); onBranch(node.id); }}><BranchIcon /></button>
                {collapse}
                <span className="node-pill-mark">{isRoot ? <Mark size={14} /> : <span className="node-seq">#{node.seq}</span>}</span>
                <span className="node-pill-text" title={node.title}>{node.title}</span>
            </div>
        );
    }

    const cls = ['node', 'node-card', working ? 'is-generating' : '', node.type === 'error' ? 'is-error' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ');
    return (
        <div className={cls} style={style} onClick={(e) => { e.stopPropagation(); onClick(node.id); }}>
            {hasArtifact && <button className="node-branch" title={`从「${node.title}」继续分叉`} onClick={(e) => { e.stopPropagation(); onBranch(node.id); }}><BranchIcon /></button>}
            {collapse}
            <div className="node-thumb">
                {hasArtifact && renderPreview ? (
                    <>
                        {/* 缩略图不跑脚本:N 个动画页同时渲染会拖死画布;动效去右侧预览看 */}
                        <iframe src={api.nodeHtmlUrl(node.id, node.updated_at)} sandbox="" scrolling="no" loading="lazy" tabIndex={-1} title={node.title} />
                        <div className="node-veil" />
                    </>
                ) : hasArtifact ? (
                    <div className="node-skeleton" aria-hidden="true"><i /><i /><i /><i /></div>
                ) : working ? (
                    <div className="node-center">
                        <span className="node-plant" title={plantOf(node.id).name} dangerouslySetInnerHTML={{ __html: plantOf(node.id).svg }} />
                        <div className="node-label">生成中…</div>
                    </div>
                ) : (
                    <div className="node-center"><div className="node-error">{node.content || '生成失败'}</div></div>
                )}
            </div>
            <div className="node-info">
                <span className={`node-type is-${node.type}`}>{node.type}</span>
                <div className="node-title"><span className="node-seq">#{node.seq}</span>{node.title}</div>
            </div>
        </div>
    );
});
