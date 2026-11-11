import { body, json, fail } from "../../http.js";

// 保存置顶组的完整顺序：ids 必须恰好是当前全部置顶对话。
export default async function put(req, res, context) {
  const { ids } = await body(req, ["ids"]);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    fail(400, "ids 必须是字符串数组");
  }
  const db = context.db;
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db
      .prepare("SELECT id FROM sessions WHERE pin IS NOT NULL")
      .all()
      .map((row) => row.id);
    if (
      ids.length !== current.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !current.includes(id))
    ) {
      fail(409, "置顶对话已变化，请刷新后再排序");
    }
    const update = db.prepare("UPDATE sessions SET pin = ? WHERE id = ?");
    for (let index = 0; index < ids.length; index++) {
      update.run(index, ids[index]);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return json(res, 200, { ids });
}
