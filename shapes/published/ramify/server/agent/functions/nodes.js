// 画布工具:新建占位、写入 / 更新一个节点、读整棵树。config.canvas 由 chat.js 注入:{ db, projectId, runId, onChange }。
import * as store from '../../db.js';

export function addNodes(args, config) {
    const { canvas } = config;
    if (typeof args.parent_id !== 'string' || !args.parent_id) throw new Error('缺少 parent_id');
    const parent = store.getNode(canvas.db, args.parent_id);
    if (!parent) throw new Error(`没有这个节点:${args.parent_id}`);
    if (parent.project_id !== canvas.projectId) throw new Error('这个节点不在当前项目里');
    const { round, placeholders } = store.addNodes(canvas.db, { parentId: parent.id, count: args.count, round: args.round, runId: canvas.runId });
    if (round) canvas.onChange?.(round);
    for (const node of placeholders) canvas.onChange?.(node);
    return { text: `已在 ${round ? `轮节点 ${round.id}「${round.title}」` : `节点 ${parent.id}`} 下建了 ${placeholders.length} 个占位:${placeholders.map((n) => n.id).join('、')}。现在逐个 write_node 写入完整作品。` };
}

export function writeNode(args, config) {
    const { canvas } = config;
    if (typeof args.id !== 'string' || !args.id) throw new Error('缺少 id');
    const node = store.getNode(canvas.db, args.id);
    if (!node) throw new Error(`没有这个节点:${args.id}`);
    if (node.project_id !== canvas.projectId) throw new Error('这个节点不在当前项目里');
    const written = store.writeNode(canvas.db, args.id, { title: args.title, type: args.type, content: args.content });
    canvas.onChange?.(written);
    const left = store.listNodes(canvas.db, canvas.projectId).filter((n) => n.run_id === canvas.runId && store.isArtifactType(n.type) && n.content === null).map((n) => n.id);
    return { text: `已写入节点 ${written.id}(${written.type},「${written.title}」,${written.content.length} 字)。${left.length ? `这一轮还有 ${left.length} 个占位节点没写:${left.join('、')}` : '这一轮的占位节点都写完了。'}` };
}

/** 树的纯文本视图:给模型看的,每行一个节点,缩进表示层级。 */
export function outline(nodes, withContent = new Set()) {
    const children = new Map();
    for (const node of nodes) {
        const key = node.parent_id || '';
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(node);
    }
    const lines = [];
    const walk = (parentId, depth) => {
        for (const node of (children.get(parentId || '') || []).sort((a, b) => a.position - b.position)) {
            const state = store.isArtifactType(node.type) ? (node.content === null ? '生成中' : `${node.content.length} 字`) : node.type === 'error' ? `失败:${node.content}` : '';
            lines.push(`${'  '.repeat(depth)}- [${node.id}] ${node.type} 「${node.title}」${state ? ` (${state})` : ''}`);
            if (withContent.has(node.id) && node.content) lines.push(`${'  '.repeat(depth + 1)}内容:\n${node.content}\n`);
            walk(node.id, depth + 1);
        }
    };
    walk(null, 0);
    return lines.join('\n');
}

export function readTree(args, config) {
    const { canvas } = config;
    const projectId = typeof args.project_id === 'string' && args.project_id ? args.project_id : canvas.projectId;
    const tree = store.getTree(canvas.db, projectId);
    if (!tree) throw new Error(`没有这个项目:${projectId}`);
    const wanted = new Set(Array.isArray(args.node_ids) ? args.node_ids.filter((id) => typeof id === 'string') : []);
    return { text: `项目 ${tree.project.id}「${tree.project.title}」\n${outline(tree.nodes, wanted)}` };
}
