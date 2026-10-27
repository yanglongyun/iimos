import get from "./get.js";
import { fail } from "../http.js";

export default function status(req, res, parts, context) {
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  switch (req.method) {
    case "GET":
      return get(req, res, context);
    default:
      fail(405, "不支持的方法");
  }
}
