import image from "./[name]/index.js";
import { fail } from "../http.js";

export default async function images(req, res, parts, context) {
  if (!parts[0]) {
    fail(404, "图片不存在");
  }
  return image(req, res, parts.slice(1), context, parts[0]);
}
