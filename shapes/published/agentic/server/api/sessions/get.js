import { json, fail } from "../http.js";

const PAGE = 50;

// 会话列表。第一页是全部置顶对话加最近更新的 50 个；之后按 before / before_id 往下翻，只翻未置顶的。
export default async function get(req, res, context) {
  const query = new URL(req.url, "http://localhost").searchParams;
  const before = query.get("before");
  const beforeId = query.get("before_id") || "";
  if (before !== null && !/^\d+$/.test(before)) {
    fail(400, "before 无效");
  }
  const columns = `sessions.*, (
    SELECT item FROM messages WHERE session_id = sessions.id ORDER BY id LIMIT 1
  ) AS first`;
  const db = context.db;
  let pinned = [];
  let rows;
  if (before === null) {
    pinned = db.prepare(`SELECT ${columns} FROM sessions WHERE pin IS NOT NULL ORDER BY pin`).all();
    rows = db
      .prepare(
        `SELECT ${columns} FROM sessions WHERE pin IS NULL ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(PAGE + 1);
  } else {
    rows = db
      .prepare(
        `
      SELECT ${columns} FROM sessions
      WHERE pin IS NULL AND (updated_at < ? OR (updated_at = ? AND id < ?))
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `,
      )
      .all(Number(before), Number(before), beforeId, PAGE + 1);
  }

  const sessions = [...pinned, ...rows.slice(0, PAGE)].map(({ first, ...session }) => {
    const content = first ? JSON.parse(first).content : [];
    let preview = content.map((part) => part.text || "").join("");
    preview = preview.replace(/\s+/g, " ").slice(0, 60);
    if (!preview && content.some((part) => part.type === "input_image")) {
      preview = "[图片]";
    }
    return {
      ...session,
      preview,
      pinned: session.pin !== null,
      running: context.runs.has(session.id),
    };
  });
  return json(res, 200, { sessions, has_more: rows.length > PAGE });
}
