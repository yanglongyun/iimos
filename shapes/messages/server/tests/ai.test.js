import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { callModel, readStream, message } from "../ai/index.js";
import { run } from "../agent/index.js";
import { defaults } from "../config.js";

const final = { status: "completed", output: [message("你好", "output_text", "assistant")] };

test("非流式读取完整响应，缺少完成状态或流式响应类型错误时直接失败", async (t) => {
  let output = final;
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(output));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const config = { responsesUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "test" };
  assert.deepEqual(await callModel("指令", [message("测试")], "fixture", config), final);
  output = { output: [] };
  await assert.rejects(callModel("指令", [message("测试")], "fixture", config), {
    code: "invalid_response",
  });
  output = final;
  await assert.rejects(
    callModel("指令", [message("测试")], "fixture", config, [], () => {}),
    { code: "invalid_response" },
  );
  assert.equal(requests, 3);
});

function streamed(data) {
  const bytes = new TextEncoder().encode(data);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) {
          controller.enqueue(Uint8Array.of(byte));
        }
        controller.close();
      },
    }),
  );
}
test("模型 SSE 按字节分片，正确处理中文、CRLF 和最终输出", async () => {
  let text = "";
  const response = await readStream(
    streamed(
      "data: " +
        JSON.stringify({ type: "response.output_text.delta", delta: "你好" }) +
        "\r\n\r\ndata: " +
        JSON.stringify({ type: "response.completed", response: final }) +
        "\r\n\r\n",
    ),
    (event) => (text += event.delta || ""),
  );
  assert.equal(text, "你好");
  assert.deepEqual(response, final);
});
test("中断和 incomplete 不作为成功结果", async () => {
  await assert.rejects(
    readStream(streamed('data: {"type":"response.output_text.delta","delta":"半句"}\n\n')),
    (error) => error.code === "stream_interrupted" && /中断/.test(error.message),
  );
  await assert.rejects(
    readStream(streamed('data: {"type":"response.incomplete","response":{"output":[]}}\n\n')),
    (error) => error.code === "model_incomplete" && /未完成/.test(error.message),
  );
});
test("真实 HTTP 模型请求、协议字段与流式解析联通", async (t) => {
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    requests++;
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
    }
    const data = JSON.parse(raw);
    assert.equal(req.headers.authorization, "Bearer test-key");
    assert.equal(data.model, "fixture-model");
    assert.equal(data.instructions, "测试指令");
    assert.equal(data.store, false);
    assert.equal(data.stream, true);
    assert.deepEqual(data.input, [message("测试")]);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      "data: " + JSON.stringify({ type: "response.output_text.delta", delta: "你好" }) + "\n\n",
    );
    res.end("data: " + JSON.stringify({ type: "response.completed", response: final }) + "\n\n");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      }),
  );
  let text = "";
  const result = await callModel(
    "测试指令",
    [message("测试")],
    "fixture-model",
    {
      responsesUrl: `http://127.0.0.1:${server.address().port}`,
      model: "must-not-use-config-model",
      apiKey: "test-key",
    },
    [],
    (event) => (text += event.delta || ""),
  );
  assert.equal(requests, 1);
  assert.equal(text, "你好");
  assert.deepEqual(result, final);
});

test("正文和思考增量分别转发，参数碎片不发，最终 output 保持原样", async () => {
  const reasoning = {
    type: "reasoning",
    id: "r1",
    content: [{ type: "reasoning_text", text: "思考内容" }],
    encrypted_content: "opaque",
    summary: [],
  };
  const call = { type: "function_call", call_id: "f1", name: "read", arguments: '{"path":"a"}' };
  const complete = { status: "completed", output: [reasoning, call], usage: { total_tokens: 20 } };
  const input = [
    { type: "response.reasoning_text.delta", delta: "思考" },
    { type: "response.reasoning_summary_text.delta", delta: "摘要" },
    { type: "response.output_text.delta", delta: "正文" },
    { type: "response.function_call_arguments.delta", delta: '{"pa' },
    { type: "response.function_call_arguments.done", arguments: call.arguments },
    { type: "response.output_item.done", item: reasoning },
    { type: "response.completed", response: complete },
  ];
  const received = [];
  const result = await readStream(
    streamed(input.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
    async (event) => {
      await Promise.resolve();
      received.push(event);
    },
  );
  assert.deepEqual(received, [
    { type: "reasoning", delta: "思考" },
    { type: "reasoning", delta: "摘要" },
    { type: "message", delta: "正文" },
  ]);
  assert.deepEqual(result, complete);
});

test("HTTP 503 重试前通知，成功后返回完整响应", async (t) => {
  let requests = 0;
  const received = [];
  const server = http.createServer((_req, res) => {
    requests++;
    res.setHeader("content-type", "application/json");
    if (requests === 1) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: { message: "暂时不可用" } }));
    } else {
      res.setHeader("content-type", "text/event-stream");
      res.end(`data: ${JSON.stringify({ type: "response.completed", response: final })}\n\n`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const result = await callModel(
    "测试指令",
    [message("测试")],
    "fixture-model",
    { responsesUrl: `http://127.0.0.1:${server.address().port}`, model: "fixture", apiKey: "test" },
    [],
    (event) => {
      assert.equal(requests, 1);
      received.push(event);
    },
  );
  assert.equal(requests, 2);
  assert.deepEqual(received, [
    { type: "retry", attempt: 1, maxRetries: 2, delayMs: 2000, error: "API HTTP 503：暂时不可用" },
  ]);
  assert.deepEqual(result, final);
});

test("重试耗尽只产生一个终止 error 和 done", async (t) => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "不可用" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const received = [];
  await run({
    instructions: "测试指令",
    model: "fixture-model",
    messages: [message("测试")],
    config: {
      ...defaults(),
      responsesUrl: `http://127.0.0.1:${server.address().port}`,
      apiKey: "test",
    },
    onEvent: (event) => received.push(event),
  });
  assert.equal(requests, 3);
  assert.deepEqual(
    received.map((event) => event.type),
    ["retry", "retry", "error", "done"],
  );
  assert.deepEqual(
    received.slice(0, 2).map((event) => [event.attempt, event.maxRetries, event.delayMs]),
    [
      [1, 2, 2000],
      [2, 2, 4000],
    ],
  );
  assert.equal(received.at(-2).code, "http_503");
  assert.deepEqual(received.at(-1), { type: "done", status: "incomplete", stopReason: "http_503" });
});

test("思考增量输出后断流不重试，避免重复展示", async (t) => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('data: {"type":"response.reasoning_text.delta","delta":"思考片段"}\n\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const received = [];
  await run({
    instructions: "测试指令",
    model: "fixture-model",
    messages: [message("测试")],
    config: {
      ...defaults(),
      responsesUrl: `http://127.0.0.1:${server.address().port}`,
      apiKey: "test",
    },
    onEvent: (event) => received.push(event),
  });
  assert.equal(requests, 1);
  assert.deepEqual(
    received.map((event) => event.type),
    ["reasoning", "error", "done"],
  );
  assert.equal(received.at(-1).stopReason, "stream_interrupted");
});

test("无效 SSE JSON 直接终止且不重试，调用方取消结束请求", async (t) => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (req.url === "/invalid") {
      res.end("data: {invalid}\n\n");
    } else {
      res.write(": waiting\n\n");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(
    callModel("", [], "test", { responsesUrl: base + "/invalid", apiKey: "test" }, [], () => {}),
    SyntaxError,
  );
  assert.equal(requests, 1);
  const signal = AbortSignal.timeout(50);
  await assert.rejects(
    callModel(
      "",
      [],
      "test",
      { responsesUrl: base + "/wait", apiKey: "test" },
      [],
      () => {},
      signal,
    ),
    { name: "TimeoutError" },
  );
  assert.equal(requests, 2);
});
