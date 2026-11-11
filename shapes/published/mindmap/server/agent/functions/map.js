// 导图工具:加、改、挪、删、读。config.canvas 由 chat.js 注入:{ db, projectId, runId, onChange, onDelete }。
import * as store from '../../db.js';

function projectIdOf(args, config) {
    return typeof args.project_id === 'string' && args.project_id ? args.project_id : config.canvas.projectId;
}

export function addTopics(args, config) {
    const { canvas } = config;
    if (typeof args.parent_id !== 'string' || !args.parent_id) throw new Error('缺少 parent_id');
    const parent = store.getNode(canvas.db, args.parent_id);
    if (!parent) throw new Error(`没有这个主题:${args.parent_id}`);
    if (parent.project_id !== canvas.projectId) throw new Error('这个主题不在当前导图里');
    const created = store.addTopics(canvas.db, { projectId: canvas.projectId, parentId: parent.id, topics: args.topics });
    for (const node of created) canvas.onChange?.(node);
    return {
        text: `已在「${parent.title}」下加了 ${created.length} 个主题:${created.map((n) => `${n.id}「${n.title}」`).join('、')}。`,
    };
}

export function updateTopic(args, config) {
    const { canvas } = config;
    if (typeof args.id !== 'string' || !args.id) throw new Error('缺少 id');
    const node = store.getNode(canvas.db, args.id);
    if (!node) throw new Error(`没有这个主题:${args.id}`);
    if (node.project_id !== canvas.projectId) throw new Error('这个主题不在当前导图里');
    const next = store.updateTopic(canvas.db, node.id, { title: args.title, note: args.note });
    canvas.onChange?.(next);
    return { text: `已更新「${next.title}」${args.note !== undefined ? '(备注也更新了)' : ''}。` };
}

export function moveTopic(args, config) {
    const { canvas } = config;
    if (typeof args.id !== 'string' || !args.id) throw new Error('缺少 id');
    const node = store.getNode(canvas.db, args.id);
    if (!node) throw new Error(`没有这个主题:${args.id}`);
    if (node.project_id !== canvas.projectId) throw new Error('这个主题不在当前导图里');
    const next = store.moveTopic(canvas.db, node.id, { parentId: args.parent_id, position: args.position });
    canvas.onChange?.(next);
    return { text: `已把「${next.title}」挪到 ${next.parent_id} 下。` };
}

export function deleteTopic(args, config) {
    const { canvas } = config;
    if (typeof args.id !== 'string' || !args.id) throw new Error('缺少 id');
    const node = store.getNode(canvas.db, args.id);
    if (!node) throw new Error(`没有这个主题:${args.id}`);
    if (node.project_id !== canvas.projectId) throw new Error('这个主题不在当前导图里');
    if (node.parent_id === null) throw new Error('中心主题不能删除');
    const ids = store.deleteTopic(canvas.db, node.id);
    canvas.onDelete?.(ids);
    return { text: `已删除「${node.title}」和它下面的 ${ids.length - 1} 个主题。` };
}

/** 纯文本大纲:给模型看的,每行一个主题,缩进表示层级。 */
export function outline(nodes) {
    const children = new Map();
    for (const node of nodes) {
        const key = node.parent_id || '';
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(node);
    }
    const lines = [];
    const walk = (parentId, depth) => {
        for (const node of (children.get(parentId || '') || []).sort((a, b) => a.position - b.position)) {
            lines.push(`${'  '.repeat(depth)}- [${node.id}] ${node.title}${node.note ? `:${node.note}` : ''}`);
            walk(node.id, depth + 1);
        }
    };
    walk(null, 0);
    return lines.join('\n');
}

export function readMap(args, config) {
    const { canvas } = config;
    const projectId = projectIdOf(args, config);
    const tree = store.getTree(canvas.db, projectId);
    if (!tree) throw new Error(`没有这个导图:${projectId}`);
    return { text: `导图 ${tree.project.id}「${tree.project.title}」\n${outline(tree.nodes)}` };
}
