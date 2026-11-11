import { saveImage } from "../../../../images.js";
import { body, json, fail } from "../../../http.js";
export default async function post(req, res, context, id) {
  if (!context.db.prepare("SELECT id FROM sessions WHERE id = ?").get(id)) {
    fail(404, "会话不存在");
  }
  const { image } = await body(req, ["image"], 14 * 1024 * 1024);
  if (typeof image !== "string") {
    fail(400, "图片必须是 Data URL");
  }
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match) {
    fail(400, "仅支持 PNG、JPEG、GIF、WebP 图片");
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 10 * 1024 * 1024) {
    fail(413, "每张图片不能超过 10 MiB");
  }
  let type;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    type = "png";
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    type = "jpeg";
  } else if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) {
    type = "gif";
  } else if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    type = "webp";
  }
  if (type !== match[1] || bytes.toString("base64") !== match[2]) {
    fail(400, "图片内容或编码无效");
  }

  const url = await saveImage(context.paths.images, bytes, `.${type}`);
  return json(res, 201, { url });
}
