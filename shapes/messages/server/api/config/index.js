import get from "./get.js";
import put from "./put.js";
import { fail } from "../http.js";

export default async function config(req, res, parts, context) {
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  switch (req.method) {
    case "GET":
      return get(req, res, context);
    case "PUT":
      return put(req, res, context);
    default:
      fail(405, "不支持的方法");
  }
}
