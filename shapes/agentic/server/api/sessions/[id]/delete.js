import fs from "node:fs/promises";
import path from "node:path";
import { json, fail } from "../../http.js";

export default async function remove(req, res, context, id) {
  if (!context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }
  if (context.runs.has(id)) {
    fail(409, "会话正在回复，请先停止");
  }
  const db = context.db;
  // 用户上传和工具图片都属于当前会话；删除记录前先取出文件名。
  const images = db
    .prepare(
      `
    SELECT DISTINCT json_extract(part.value, '$.image_url') AS url
    FROM messages, json_each(CASE
      WHEN json_extract(messages.item, '$.type') = 'message' THEN json_extract(messages.item, '$.content')
      WHEN json_type(messages.item, '$.output') = 'array' THEN json_extract(messages.item, '$.output')
      ELSE '[]' END) AS part
    WHERE session_id = ? AND json_extract(part.value, '$.type') = 'input_image'
  `,
    )
    .all(id);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM compactions WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const image of images) {
    await fs.rm(path.join(context.paths.images, path.basename(image.url)), { force: true });
  }
  return json(res, 200, { deleted: id });
}
