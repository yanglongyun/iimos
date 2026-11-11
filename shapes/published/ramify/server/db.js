// 树的存储:node:sqlite,文件在 $IIMOS_DATA/ramify/ramify.db。
//
// 三张表:projects(一个画布 = 一个项目)、nodes(树上的节点)、runs(每次让 agent 生成一批的记录)。
// 节点只有一种:parent_id + position 定树形;type 决定内容是什么:
//   text      标题节点:根(title = 需求)和每次发散的「轮」(title = 修改要求),content 为空
//   html / markdown / svg   作品节点,content 是完整源码;content 为 NULL 表示还在生成
//   error     生成失败,content 是原因
// 启动时执行建表语句,不写迁移;改表结构要向前兼容(回滚只回代码,不回数据)。
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const ARTIFACT_TYPES = ['html', 'markdown', 'svg'];
export const NODE_TYPES = ['text', ...ARTIFACT_TYPES, 'error'];
export const isArtifactType = (type) => ARTIFACT_TYPES.includes(type);

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
  type       TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','html','markdown','svg','error')),
  title      TEXT NOT NULL,
  content    TEXT,
  run_id     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS nodes_project ON nodes(project_id, parent_id, position);
-- 每个项目一条对话:messages 每行一个模型 item(Responses 协议的 input item);usage 附在每次模型响应的最后一项
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, id);
-- 上下文摘要,覆盖到 message_id(含);之后的消息原样发给模型
CREATE TABLE IF NOT EXISTS compactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL,
  summary    TEXT NOT NULL,
  item       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS compactions_project ON compactions(project_id, id);
-- 对话的运行态:上一次模型响应报的 total_tokens(压缩依据)
CREATE TABLE IF NOT EXISTS chats (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  tokens     INTEGER NOT NULL DEFAULT 0
);
`;

export const newId = () => randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

export function openDatabase(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec(SCHEMA);
    // 上次进程没走完就退了:还空着的作品节点不会再有人填,标成失败
    db.prepare(`UPDATE nodes SET type = 'error', content = '应用在生成过程中退出了', updated_at = ? WHERE type IN ('html','markdown','svg') AND content IS NULL`).run(now());
    return db;
}

// ── 项目 ──────────────────────────────────────────────

export function listProjects(db) {
    return db.prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM nodes n WHERE n.project_id = p.id AND n.type IN ('html','markdown','svg') AND n.content IS NOT NULL) AS done_count,
          (SELECT COUNT(*) FROM nodes n WHERE n.project_id = p.id AND n.type IN ('html','markdown','svg') AND n.content IS NULL) AS generating_count,
          (SELECT n.id FROM nodes n WHERE n.project_id = p.id AND n.type IN ('html','markdown','svg') AND n.content IS NOT NULL ORDER BY n.created_at DESC LIMIT 1) AS preview_node_id
        FROM projects p ORDER BY p.updated_at DESC`).all();
}

export const getProject = (db, id) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;

/** 新建项目:根节点的标题就是需求。方案节点由 agent 在对话里用 add_nodes 建。返回 { project, root }。 */
export function createProject(db, { prompt }) {
    const text = String(prompt || '').trim();
    if (!text) throw Object.assign(new Error('需求不能为空'), { status: 400 });
    const id = newId();
    const title = text.split(/\r?\n/)[0].slice(0, 60);
    db.prepare('INSERT INTO projects (id, title, prompt) VALUES (?, ?, ?)').run(id, title, text);
    db.prepare('INSERT INTO chats (project_id, tokens) VALUES (?, 0)').run(id);
    const root = insertNode(db, { projectId: id, parentId: null, position: 0, type: 'text', title: text });
    return { project: getProject(db, id), root };
}

export function deleteProject(db, id) {
    return db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}

export const touchProject = (db, id) => db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), id);

// ── 节点 ──────────────────────────────────────────────

export const getNode = (db, id) => db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) || null;

export function insertNode(db, { projectId, parentId, position, type = 'text', title, content = null, runId = null }) {
    const id = newId();
    db.prepare('INSERT INTO nodes (id, project_id, parent_id, position, type, title, content, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, projectId, parentId, position, type, title, content, runId);
    return getNode(db, id);
}

const nextPosition = (db, parentId) =>
    (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM nodes WHERE parent_id = ?').get(parentId).p);

/** 在 parentId 下挂 count 个「生成中」的作品节点(type 先记 html,agent 写入时可以改)。 */
export function createPlaceholders(db, { projectId, parentId, count, runId }) {
    const n = Math.max(1, Math.min(8, Math.round(Number(count)) || 1));
    const start = nextPosition(db, parentId);
    const nodes = [];
    for (let i = 0; i < n; i += 1) {
        nodes.push(insertNode(db, { projectId, parentId, position: start + i, type: 'html', title: `方案 ${i + 1}`, runId }));
    }
    return nodes;
}

/**
 * agent 在某个节点下新建一批占位作品节点。给了 round(修改要求)就先插一个「轮」节点(标题 = round),占位挂在轮下;
 * 没给就直接挂在 parentId 下(根节点的第一批方案)。旧节点一个都不动。返回 { parent, round, placeholders }。
 */
export function addNodes(db, { parentId, count, round = '', runId = null }) {
    const parent = getNode(db, parentId);
    if (!parent) throw Object.assign(new Error(`没有这个节点:${parentId}`), { status: 404 });
    const text = String(round || '').trim();
    let under = parent;
    if (text) under = insertNode(db, { projectId: parent.project_id, parentId: parent.id, position: nextPosition(db, parent.id), type: 'text', title: text.slice(0, 200) });
    const placeholders = createPlaceholders(db, { projectId: parent.project_id, parentId: under.id, count, runId });
    touchProject(db, parent.project_id);
    return { parent, round: text ? under : null, placeholders };
}

/** agent 写入 / 更新一个节点:type 决定内容是什么;error 的 content 是失败原因。 */
export function writeNode(db, id, { title, type, content }) {
    const node = getNode(db, id);
    if (!node) throw new Error(`没有这个节点:${id}`);
    if (node.parent_id === null) throw new Error('根节点是需求本身,不能改写');
    const nextType = type === undefined ? node.type : type;
    if (!NODE_TYPES.includes(nextType)) throw new Error(`type 必须是 ${NODE_TYPES.join(' / ')} 之一`);
    if (nextType === 'text') throw new Error('text 是标题节点,作品节点请用 html / markdown / svg');
    if (typeof content !== 'string' || !content.trim()) throw new Error('content 不能为空');
    const nextTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : node.title;
    db.prepare('UPDATE nodes SET title = ?, type = ?, content = ?, updated_at = ? WHERE id = ?')
        .run(nextTitle, nextType, content, now(), id);
    touchProject(db, node.project_id);
    return getNode(db, id);
}

export function listNodes(db, projectId) {
    return db.prepare('SELECT * FROM nodes WHERE project_id = ? ORDER BY created_at, position').all(projectId);
}

/** 整棵树:节点按创建顺序编号(seq),给界面和 agent 看。 */
export function getTree(db, projectId) {
    const project = getProject(db, projectId);
    if (!project) return null;
    const nodes = listNodes(db, projectId).map((node, index) => ({ ...node, seq: index + 1 }));
    return { project, nodes };
}

// ── 对话 ──────────────────────────────────────────────

const parseMessage = (row) => ({ id: row.id, created_at: row.created_at, ...JSON.parse(row.item) });

/** 存一条完整 item,返回带 id / created_at 的副本。 */
export function saveMessage(db, projectId, item) {
    const row = db.prepare('INSERT INTO messages (project_id, item) VALUES (?, ?)').run(projectId, JSON.stringify(item));
    touchProject(db, projectId);
    return parseMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(row.lastInsertRowid));
}

/** 最近的一页消息(按 id 升序返回);before 给了就取它之前的。返回 { messages, has_more }。 */
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

/** 发给模型的上下文:最近一次摘要 + 它之后的全部消息。返回 { items(带 id), head } —— head 是摘要消息(可能没有)。 */
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

/** 一轮结束:这一轮建的、还空着的占位节点标成失败。返回被标的节点 id。 */
export function failEmptyPlaceholders(db, runId, reason) {
    const empty = db.prepare(`SELECT id FROM nodes WHERE run_id = ? AND type IN ('html','markdown','svg') AND content IS NULL`).all(runId);
    for (const node of empty) db.prepare(`UPDATE nodes SET type = 'error', content = ?, updated_at = ? WHERE id = ?`).run(reason, now(), node.id);
    return empty.map((node) => node.id);
}
