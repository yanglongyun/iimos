// 测试专用的本地模型接口，让 Agent 经过真实 AI 请求和 SSE 解析。
import http from "node:http";

export default async function modelServer(t, respond) {
  const assertions = [];
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) {
        controller.abort();
      }
    });
    const emit = (event) => {
      if (res.destroyed) {
        return;
      }
      if (!res.headersSent) {
        res.writeHead(200, { "content-type": "text/event-stream" });
      }
      if (event.type === "message") {
        event = { type: "response.output_text.delta", delta: event.delta };
      } else if (event.type === "reasoning") {
        event = { type: "response.reasoning_text.delta", delta: event.delta };
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
      }
      const result = await respond(JSON.parse(raw), emit, controller.signal);
      if (res.destroyed) {
        return;
      }
      if (result.status === "incomplete") {
        emit({ type: "response.incomplete", response: result });
      } else {
        emit({ type: "response.completed", response: { status: "completed", ...result } });
      }
      res.end();
    } catch (error) {
      if (error.code === "ERR_ASSERTION") {
        assertions.push(error);
      }
      if (res.destroyed) {
        return;
      }
      if (res.headersSent) {
        emit({ type: "error", message: error.message });
        res.end();
      } else {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: error.message } }));
      }
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    if (assertions.length > 0) {
      throw assertions[0];
    }
  });
  return `http://127.0.0.1:${server.address().port}`;
}
