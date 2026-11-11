import get from "./get.js";
import post from "./post.js";
import { fail } from "../../../http.js";

export default async function messages(req, res, parts, context, id) {
  if (parts.length > 0) {
    fail(404, "接口不存在");
  }
  switch (req.method) {
    case "GET":
      return get(req, res, context, id);
    case "POST":
      return post(req, res, context, id);
    default:
      fail(405, "不支持的方法");
  }
}
