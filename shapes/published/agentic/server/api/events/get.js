// 事件通道：一条 SSE 长连接，整个应用共用，只往下推。断开后浏览器自动重连。
export default async function get(req, res, context) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  // 断开后 1.5 秒重连。
  res.write("retry: 1500\n\n");
  context.streams.add(res);
  req.on("close", () => context.streams.delete(res));
}
