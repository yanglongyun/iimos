import { json, fail } from "../../../http.js";

export default async function get(req, res, context, id) {
  if (!context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }
  const query = new URL(req.url, "http://localhost").searchParams;
  const limitText = query.get("limit") ?? "60";
  const beforeText = query.get("before") ?? "0";
  if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(Number(limitText))) {
    fail(400, "limit 无效");
  }
  if (!/^\d+$/.test(beforeText) || !Number.isSafeInteger(Number(beforeText))) {
    fail(400, "before 无效");
  }
  const limit = Math.min(500, Math.max(1, Number(limitText)));
  const before = Number(beforeText);
  const rows = context.db
    .prepare(
      `
    SELECT * FROM messages
    WHERE session_id = ? AND (? = 0 OR id < ?)
    ORDER BY id DESC LIMIT ?
  `,
    )
    .all(id, before, before, limit + 1);
  const messages = rows
    .slice(0, limit)
    .reverse()
    .map((row) => ({
      ...row,
      item: JSON.parse(row.item),
      usage: row.usage ? JSON.parse(row.usage) : null,
    }));
  return json(res, 200, { messages, has_more: rows.length > limit });
}
