// 接口共用的少量 HTTP 读写函数。
export function fail(status, text) {
  const error = new Error(text);
  error.status = status;
  throw error;
}
export function json(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}
export async function body(req, fields, limit = 160 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      fail(413, "请求过大");
    }
    chunks.push(chunk);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    fail(400, "JSON 无效");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail(400, "请求必须是对象");
  }
  if (fields && Object.keys(data).some((key) => !fields.includes(key))) {
    fail(400, "请求包含未知字段");
  }
  return data;
}
