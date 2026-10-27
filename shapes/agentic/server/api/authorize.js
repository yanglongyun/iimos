import { timingSafeEqual } from "node:crypto";
import { fail } from "./http.js";

// 桌面端每次启动生成一次性令牌，写进窗口的 Cookie；本机其他程序和网页拿不到它。
export default function authorize(req, context) {
  const value = /(?:^|;\s*)agentic_token=([^;]+)/.exec(req.headers.cookie || "")?.[1] || "";
  const provided = Buffer.from(value);
  const expected = Buffer.from(context.token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    fail(401, "未授权");
  }
}
