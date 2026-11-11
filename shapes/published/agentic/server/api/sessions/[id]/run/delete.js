import { json } from "../../../http.js";

// 停止这个会话正在运行的回复，等它真正结束（done 已推送）再返回。
export default async function remove(req, res, context, id) {
  const run = context.runs.get(id);
  if (run) {
    run.controller.abort(new DOMException("已停止", "AbortError"));
    await run.done;
  }
  return json(res, 200, { stopped: Boolean(run) });
}
