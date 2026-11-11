import put from "./put.js";
import { fail } from "../../http.js";

export default async function pins(req, res, parts, context) {
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  switch (req.method) {
    case "PUT":
      return put(req, res, context);
    default:
      fail(405, "不支持的方法");
  }
}
