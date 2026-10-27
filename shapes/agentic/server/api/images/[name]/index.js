import get from "./get.js";
import { fail } from "../../http.js";

export default async function image(req, res, parts, context, name) {
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  switch (req.method) {
    case "GET":
    case "HEAD":
      return get(req, res, context, name);
    default:
      fail(405, "不支持的方法");
  }
}
