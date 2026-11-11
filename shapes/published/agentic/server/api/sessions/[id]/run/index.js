import remove from "./delete.js";
import { fail } from "../../../http.js";

export default async function run(req, res, parts, context, id) {
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  switch (req.method) {
    case "DELETE":
      return remove(req, res, context, id);
    default:
      fail(405, "不支持的方法");
  }
}
