import { json, fail } from "../../http.js";

// 打开对话：最近 60 条消息、压缩记录、是否正在运行，以及正在运行时已输出但还没形成完整 item 的文字。
export default async function get(req, res, context, id) {
  const db = context.db;
  if (!db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 61")
    .all(id);
  const messages = rows
    .slice(0, 60)
    .reverse()
    .map((row) => ({
      ...row,
      item: JSON.parse(row.item),
      usage: row.usage ? JSON.parse(row.usage) : null,
    }));
  const compactions = db
    .prepare("SELECT * FROM compactions WHERE session_id = ? ORDER BY id")
    .all(id);
  const run = context.runs.get(id);
  return json(res, 200, {
    messages,
    has_more: rows.length > 60,
    compactions,
    running: Boolean(run),
    streaming: run ? { text: run.text, reasoning: run.reasoning } : null,
  });
}
