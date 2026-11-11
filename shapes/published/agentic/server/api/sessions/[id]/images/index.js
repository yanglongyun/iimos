import post from "./post.js";
import { fail } from "../../../http.js";
export default function images(req, res, parts, context, id) {
  if (parts.length) {
    fail(404, "接口不存在");
  }
  if (req.method === "POST") {
    return post(req, res, context, id);
  }
  fail(405, "不支持的方法");
}
