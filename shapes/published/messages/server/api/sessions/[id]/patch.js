import { body, json, fail } from "../../http.js";

// 修改标题，或置顶 / 取消置顶。新置顶的对话排在置顶组最前面。
export default async function patch(req, res, context, id) {
  const data = await body(req, ["title", "pinned"]);
  if (data.title === undefined && data.pinned === undefined) {
    fail(400, "缺少要修改的字段");
  }
  if (
    data.title !== undefined &&
    (typeof data.title !== "string" || [...data.title.trim()].length > 120)
  ) {
    fail(400, "标题最多 120 字符");
  }
  if (data.pinned !== undefined && typeof data.pinned !== "boolean") {
    fail(400, "pinned 必须是布尔值");
  }
  const db = context.db;
  if (!db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (data.title !== undefined) {
      db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(data.title.trim(), id);
    }
    if (
      data.pinned === true &&
      db.prepare("SELECT pin FROM sessions WHERE id = ?").get(id).pin === null
    ) {
      const first = db.prepare("SELECT MIN(pin) AS pin FROM sessions").get().pin;
      let pin = 0;
      if (first !== null) {
        pin = first - 1;
      }
      db.prepare("UPDATE sessions SET pin = ? WHERE id = ?").run(pin, id);
    }
    if (data.pinned === false) {
      db.prepare("UPDATE sessions SET pin = NULL WHERE id = ?").run(id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  const pinned = session.pin !== null;
  return json(res, 200, { ...session, pinned, running: context.runs.has(id) });
}
