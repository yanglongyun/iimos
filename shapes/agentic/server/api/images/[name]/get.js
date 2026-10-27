import { readImage } from "../../../images.js";
import { fail } from "../../http.js";

export default async function get(req, res, context, name) {
  let image;
  try {
    image = await readImage(context.paths.images, name);
  } catch (error) {
    if (error.code === "ENOENT") {
      fail(404, "图片不存在");
    }
    throw error;
  }
  res.writeHead(200, {
    "content-type": image.type,
    "content-length": image.bytes.length,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  });
  res.end(req.method === "HEAD" ? undefined : image.bytes);
}
