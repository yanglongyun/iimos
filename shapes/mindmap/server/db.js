// 导图的存储:node:sqlite,文件在 $IIMOS_DATA/mindmap/mindmap.db。
//
// 一个 project = 一张导图;nodes 是主题树,parent_id + position 定树形。
// 根节点的 title 就是中心主题;每个节点还可以有一小段 note(给 agent 和用户看的补充)。
// 对话、压缩摘要和 token 记在另外三张表里。
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS nodes (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  title      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  side       TEXT NOT NULL DEFAULT 'right',
  collapsed  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS nodes_project ON nodes(project_id, parent_id, position);
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, id);
CREATE TABLE IF NOT EXISTS compactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL,
  summary    TEXT NOT NULL,
  item       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS compactions_project ON compactions(project_id, id);
CREATE TABLE IF NOT EXISTS chats (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  tokens     INTEGER NOT NULL DEFAULT 0
);
`;

export const newId = () => randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function openDatabase(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return new DatabaseSync(file);
}

/** 建表单独拿出来,方便测试和启动时调用。 */
export function migrate(db) {
    db.exec(SCHEMA);
    // 老版本没有 side;新库由 SCHEMA 建好,老库补一列。
    try { db.exec("ALTER TABLE nodes ADD COLUMN side TEXT NOT NULL DEFAULT 'right'"); } catch { /* 已有 */ }
}

// ── 导图 ──────────────────────────────────────────────

export function listProjects(db) {
    return db.prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM nodes n WHERE n.project_id = p.id) AS node_count,
          (SELECT COUNT(*) FROM nodes n WHERE n.project_id = p.id AND n.parent_id IS NOT NULL) AS topic_count
        FROM projects p ORDER BY p.updated_at DESC`).all();
}

export const getProject = (db, id) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;

/** 新建一张导图:先只有中心主题,agent 在首轮对话里展开它。 */
export function createProject(db, { title }) {
    const text = String(title || '').trim();
    if (!text) throw Object.assign(new Error('中心主题不能为空'), { status: 400 });
    const id = newId();
    const label = clean(text.split(/\r?\n/)[0], 60);
    db.prepare('INSERT INTO projects (id, title, prompt) VALUES (?, ?, ?)').run(id, label, text);
    db.prepare('INSERT INTO chats (project_id, tokens) VALUES (?, 0)').run(id);
    const root = insertTopic(db, { projectId: id, parentId: null, position: 0, title: label, note: '' });
    return { project: getProject(db, id), root };
}

export function deleteProject(db, id) {
    return db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}

export const touchProject = (db, id) => db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), id);

export function renameProject(db, id, title) {
    const text = clean(title, 120);
    if (!text) throw new Error('导图名字不能为空');
    db.prepare('UPDATE projects SET title = ?, updated_at = ? WHERE id = ?').run(text, now(), id);
    return getProject(db, id);
}

// ── 主题 ──────────────────────────────────────────────

export const getNode = (db, id) => db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) || null;

export const nextTopicPosition = (db, projectId, parentId) => nextPosition(db, projectId, parentId);

const nextPosition = (db, projectId, parentId) => {
    const row = parentId === null
        ? db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM nodes WHERE project_id = ? AND parent_id IS NULL').get(projectId)
        : db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM nodes WHERE project_id = ? AND parent_id = ?').get(projectId, parentId);
    return row.p;
};

export function insertTopic(db, { projectId, parentId, position, title, note = '', side = 'right' }) {
    const id = newId();
    const text = clean(title, 200);
    if (!text) throw new Error('主题不能为空');
    db.prepare('INSERT INTO nodes (id, project_id, parent_id, position, title, note, side) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, projectId, parentId, position, text, String(note || '').slice(0, 4000), side === 'left' ? 'left' : 'right');
    touchProject(db, projectId);
    return getNode(db, id);
}

/** agent 一次加一批子主题;topics = [{ title, note? }]。 */
export function addTopics(db, { projectId, parentId, topics }) {
    const parent = getNode(db, parentId);
    if (!parent) throw new Error(`没有这个主题:${parentId}`);
    if (parent.project_id !== projectId) throw new Error('这个主题不在当前导图里');
    if (!Array.isArray(topics) || !topics.length) throw new Error('topics 要是非空数组');
    const start = nextPosition(db, projectId, parentId);
    const created = [];
    const inherited = parent.parent_id ? (parent.side || 'right') : null;
    for (const [index, topic] of topics.slice(0, 20).entries()) {
        if (!topic || typeof topic.title !== 'string' || !topic.title.trim()) throw new Error(`第 ${index + 1} 个主题缺少 title`);
        const side = topic.side === 'left' || topic.side === 'right'
            ? topic.side
            : inherited || (index % 2 === 0 ? 'right' : 'left');
        created.push(insertTopic(db, {
            projectId, parentId, position: start + index,
            title: topic.title, note: typeof topic.note === 'string' ? topic.note : '', side,
        }));
    }
    return created;
}

/** 改标题或备注;省略的字段保持原样。 */
export function updateTopic(db, id, { title, note } = {}) {
    const node = getNode(db, id);
    if (!node) throw new Error(`没有这个主题:${id}`);
    const nextTitle = title === undefined ? node.title : clean(title, 200);
    if (!nextTitle) throw new Error('主题不能为空');
    const nextNote = note === undefined ? node.note : String(note).slice(0, 4000);
    db.prepare('UPDATE nodes SET title = ?, note = ?, updated_at = ? WHERE id = ?').run(nextTitle, nextNote, now(), id);
    touchProject(db, node.project_id);
    return getNode(db, id);
}

/** 画布引擎用的通用 patch:text/title、note、collapsed、side、sort_order、parent_id。 */
export function patchTopic(db, id, patch = {}) {
    const node = getNode(db, id);
    if (!node) throw new Error(`没有这个主题:${id}`);
    let parentId = node.parent_id;
    if ('parent_id' in patch && patch.parent_id !== node.parent_id) {
        if (node.parent_id === null) throw new Error('中心主题不能移动');
        const parent = getNode(db, patch.parent_id);
        if (!parent || parent.project_id !== node.project_id) throw new Error('新的父主题不在同一张导图里');
        if (parent.id === id || descendants(db, node.project_id, id).includes(parent.id)) throw new Error('不能把主题挪进自己的子树');
        parentId = parent.id;
    }
    const rawTitle = 'title' in patch ? patch.title : ('text' in patch ? patch.text : node.title);
    const title = clean(rawTitle, 200);
    if (!title) throw new Error('主题不能为空');
    const note = 'note' in patch ? String(patch.note || '').slice(0, 4000) : node.note;
    const side = 'side' in patch ? (patch.side === 'left' ? 'left' : 'right') : node.side;
    const sortOrder = 'sort_order' in patch ? Number(patch.sort_order) : ('sortOrder' in patch ? Number(patch.sortOrder) : node.position);
    const collapsed = 'collapsed' in patch ? (patch.collapsed ? 1 : 0) : node.collapsed;
    db.prepare('UPDATE nodes SET parent_id = ?, title = ?, note = ?, side = ?, position = ?, collapsed = ?, updated_at = ? WHERE id = ?')
        .run(parentId, title, note, side, Number.isFinite(sortOrder) ? sortOrder : node.position, collapsed, now(), id);
    touchProject(db, node.project_id);
    return getNode(db, id);
}

function descendants(db, projectId, id) {
    return db.prepare(`WITH RECURSIVE tree(id) AS (
        SELECT id FROM nodes WHERE project_id = ? AND parent_id = ?
        UNION ALL SELECT n.id FROM nodes n JOIN tree t ON n.parent_id = t.id
    ) SELECT id FROM tree`).all(projectId, id).map((row) => row.id);
}

/** 挪一个主题;不能把主题挪进自己的子树,根不能挪。 */
export function moveTopic(db, id, { parentId, position } = {}) {
    const node = getNode(db, id);
    if (!node) throw new Error(`没有这个主题:${id}`);
    if (node.parent_id === null) throw new Error('中心主题不能移动');
    if (typeof parentId !== 'string' || !parentId) throw new Error('缺少新的 parent_id');
    const parent = getNode(db, parentId);
    if (!parent || parent.project_id !== node.project_id) throw new Error('新的父主题不在同一张导图里');
    if (parentId === id || descendants(db, node.project_id, id).includes(parentId)) throw new Error('不能把主题挪进自己的子树');
    const target = Number.isFinite(Number(position)) ? Number(position) : nextPosition(db, node.project_id, parentId);
    db.prepare('UPDATE nodes SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?').run(parentId, target, now(), id);
    touchProject(db, node.project_id);
    return getNode(db, id);
}

/** 同级插入排序。一次事务重编号,避免重复 position 让画布和大纲排序不一致。 */
export function reorderTopic(db, id, { beforeId = null } = {}) {
    const node = getNode(db, id);
    if (!node) throw new Error(`没有这个主题:${id}`);
    if (node.parent_id === null) throw new Error('中心主题不能排序');
    const parent = getNode(db, node.parent_id);
    const siblings = db.prepare('SELECT * FROM nodes WHERE project_id = ? AND parent_id = ? ORDER BY position, created_at, id')
        .all(node.project_id, node.parent_id);
    // 中心主题左右两侧分别排序;更深的主题跟随祖先侧,都属于同一个序列。
    const sameGroup = (sibling) => parent.parent_id !== null || sibling.side === node.side;
    const group = siblings.filter(sameGroup);
    if (beforeId !== null && (beforeId === id || !group.some((sibling) => sibling.id === beforeId))) {
        throw new Error('排序目标必须是同侧的同级主题');
    }
    const ordered = group.filter((sibling) => sibling.id !== id);
    const index = beforeId === null ? ordered.length : ordered.findIndex((sibling) => sibling.id === beforeId);
    ordered.splice(index, 0, node);
    // 把左右两侧重新排好的主题放回原来的侧别槽位,另一侧的相对顺序保持不变。
    let offset = 0;
    const result = siblings.map((sibling) => sameGroup(sibling) ? ordered[offset++] : sibling);
    db.exec('BEGIN IMMEDIATE');
    try {
        const update = db.prepare('UPDATE nodes SET position = ?, updated_at = ? WHERE id = ?');
        const stamp = now();
        result.forEach((sibling, position) => update.run(position, stamp, sibling.id));
        touchProject(db, node.project_id);
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    return result.map((sibling) => getNode(db, sibling.id));
}

/** 删一个主题和整棵子树;根不能删。返回被删的 id。 */
export function deleteTopic(db, id) {
    const node = getNode(db, id);
    if (!node) throw new Error(`没有这个主题:${id}`);
    if (node.parent_id === null) throw new Error('中心主题不能删除');
    const ids = [id, ...descendants(db, node.project_id, id)];
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    touchProject(db, node.project_id);
    return ids;
}

export function listNodes(db, projectId) {
    return db.prepare('SELECT * FROM nodes WHERE project_id = ? ORDER BY position, created_at').all(projectId);
}

/** 整棵树:节点按读出来的顺序编号(seq),给界面和 agent 看。 */
export function getTree(db, projectId) {
    const project = getProject(db, projectId);
    if (!project) return null;
    const nodes = listNodes(db, projectId).map((node, index) => ({ ...node, seq: index + 1 }));
    return { project, nodes };
}

// ── 对话 ──────────────────────────────────────────────

const parseMessage = (row) => ({ id: row.id, created_at: row.created_at, ...JSON.parse(row.item) });

export function saveMessage(db, projectId, item) {
    const row = db.prepare('INSERT INTO messages (project_id, item) VALUES (?, ?)').run(projectId, JSON.stringify(item));
    touchProject(db, projectId);
    return parseMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(row.lastInsertRowid));
}

export function listMessages(db, projectId, { before = null, limit = 200 } = {}) {
    const rows = before
        ? db.prepare('SELECT * FROM messages WHERE project_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(projectId, before, limit + 1)
        : db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(projectId, limit + 1);
    const has_more = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse().map(parseMessage), has_more };
}

export function listCompactions(db, projectId) {
    return db.prepare('SELECT id, message_id, summary, created_at FROM compactions WHERE project_id = ? ORDER BY id').all(projectId);
}

export function liveMessages(db, projectId) {
    const last = db.prepare('SELECT message_id, item FROM compactions WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(projectId);
    const rows = last
        ? db.prepare('SELECT * FROM messages WHERE project_id = ? AND id > ? ORDER BY id').all(projectId, last.message_id)
        : db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY id').all(projectId);
    return { head: last ? JSON.parse(last.item) : null, items: rows.map(parseMessage) };
}

export function saveCompaction(db, projectId, { messageId, summary, item }) {
    db.prepare('INSERT INTO compactions (project_id, message_id, summary, item) VALUES (?, ?, ?, ?)').run(projectId, messageId, summary, JSON.stringify(item));
}

export const getTokens = (db, projectId) => db.prepare('SELECT tokens FROM chats WHERE project_id = ?').get(projectId)?.tokens || 0;
export function setTokens(db, projectId, tokens) {
    db.prepare('INSERT INTO chats (project_id, tokens) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET tokens = excluded.tokens').run(projectId, tokens);
}
