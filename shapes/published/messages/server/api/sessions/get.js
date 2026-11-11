import { json, fail } from "../http.js";

const PAGE = 50;

// 列表每行附带两段文字：subject 是第一条用户消息（没起标题时当标题用），preview 是最后一条正文（列表里的那句预览）。
const COLUMNS = `sessions.*, (
    SELECT item FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1
  ) AS first, (
    SELECT item FROM messages
    WHERE session_id = sessions.id AND json_extract(item, '$.type') = 'message'
    ORDER BY id DESC LIMIT 1
  ) AS last`;

function text(raw) {
  if (!raw) {
    return "";
  }
  const content = JSON.parse(raw).content;
  if (!Array.isArray(content)) {
    return "";
  }
  let value = content
    .map((part) => part.text || "")
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!value && content.some((part) => part.type === "input_image")) {
    value = "[图片]";
  }
  return value;
}

export function view(context, { first, last, ...session }) {
  return {
    ...session,
    subject: text(first),
    preview: text(last),
    last_role: last ? JSON.parse(last).role : "",
    pinned: session.pin !== null,
    running: context.runs.has(session.id),
  };
}

// 会话列表。第一页是全部置顶对话加最近更新的 50 个；之后按 before / before_id 往下翻，只翻未置顶的。
// 带 q 时是搜索：标题或任一条消息正文包含 q 的对话，按更新时间取前 50 个，不分页。
export default async function get(req, res, context) {
  const query = new URL(req.url, "http://localhost").searchParams;
  const before = query.get("before");
  const beforeId = query.get("before_id") || "";
  const q = (query.get("q") || "").trim();
  if (before !== null && !/^\d+$/.test(before)) {
    fail(400, "before 无效");
  }
  const db = context.db;
  if (q) {
    if (q.length > 200) {
      fail(400, "搜索词过长");
    }
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = db
      .prepare(
        `
      SELECT ${COLUMNS} FROM sessions
      WHERE title LIKE ? ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM messages, json_each(json_extract(messages.item, '$.content')) AS part
        WHERE messages.session_id = sessions.id
          AND json_extract(messages.item, '$.type') = 'message'
          AND json_extract(part.value, '$.text') LIKE ? ESCAPE '\\'
      )
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `,
      )
      .all(pattern, pattern, PAGE);
    return json(res, 200, { sessions: rows.map((row) => view(context, row)), has_more: false });
  }
  let pinned = [];
  let rows;
  if (before === null) {
    pinned = db.prepare(`SELECT ${COLUMNS} FROM sessions WHERE pin IS NOT NULL ORDER BY pin`).all();
    rows = db
      .prepare(
        `SELECT ${COLUMNS} FROM sessions WHERE pin IS NULL ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(PAGE + 1);
  } else {
    rows = db
      .prepare(
        `
      SELECT ${COLUMNS} FROM sessions
      WHERE pin IS NULL AND (updated_at < ? OR (updated_at = ? AND id < ?))
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `,
      )
      .all(Number(before), Number(before), beforeId, PAGE + 1);
  }
  const sessions = [...pinned, ...rows.slice(0, PAGE)].map((row) => view(context, row));
  return json(res, 200, { sessions, has_more: rows.length > PAGE });
}
