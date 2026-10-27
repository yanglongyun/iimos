import get from "./get.js";
import post from "./post.js";
import session from "./[id]/index.js";
import pins from "./pins/index.js";
import { fail } from "../http.js";

export default async function sessions(req, res, parts, context) {
  if (parts[0] === "pins") {
    return pins(req, res, parts.slice(1), context);
  }
  if (parts.length > 0) {
    const id = parts[0];
    return session(req, res, parts.slice(1), context, id);
  }

  switch (req.method) {
    case "GET":
      return get(req, res, context);
    case "POST":
      return post(req, res, context);
    default:
      fail(405, "不支持的方法");
  }
}
