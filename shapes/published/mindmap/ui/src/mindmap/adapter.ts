// 把参考引擎的三个持久化出口接到本形态的 HTTP 接口上。
import { api } from '../api';
import type { Topic as ApiTopic } from '../types';
import type { SaveAdapter, Topic } from './types';

export function toEngine(node: ApiTopic): Topic {
    return {
        id: node.id,
        parent_id: node.parent_id,
        text: node.title,
        note: node.note,
        side: node.side === 'left' ? 'left' : 'right',
        sort_order: node.position,
        collapsed: node.collapsed ? 1 : 0,
        created_at: Date.parse(node.created_at) || Date.now(),
    };
}

export function saveAdapter(projectId: string): SaveAdapter {
    return {
        async create({ parentId, text, side, sortOrder }) {
            const { node } = await api.addTopic(projectId, parentId!, text, '', side, sortOrder);
            return toEngine(node);
        },
        async patch(id, patch) {
            const body: Record<string, unknown> = {};
            if ('text' in patch) body.title = patch.text;
            if ('collapsed' in patch) body.collapsed = patch.collapsed;
            if ('side' in patch) body.side = patch.side;
            if ('sortOrder' in patch) body.sort_order = patch.sortOrder;
            if ('parentId' in patch) body.parent_id = patch.parentId;
            await api.updateTopic(id, body);
        },
        async reorder(id, beforeId) {
            await api.reorderTopic(id, beforeId);
        },
        async remove(id) {
            await api.deleteTopic(id);
        },
    };
}
