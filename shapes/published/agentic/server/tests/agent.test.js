import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaults } from "../config.js";
import tools from "../agent/tools.js";
import runTool from "../agent/runner.js";
import { run } from "../agent/index.js";
import compact from "../agent/compact.js";
import { message } from "../ai/index.js";
import modelServer from "./model.js";

async function workspace(t) {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-tools-"));
  t.after(() => fs.rm(workdir, { recursive: true, force: true }));
  return { ...defaults(), workdir };
}
test("工具定义齐全；四个本机工具实际读写、精确替换、命令执行与错误反馈", async (t) => {
  const c = await workspace(t);
  assert.deepEqual(
    tools.map((t) => t.name),
    ["shell", "read", "write", "edit", "browser"],
  );
  await runTool(
    {
      name: "write",
      arguments: JSON.stringify({ path: "folder/a.txt", content: "你好\n重复\n重复\n" }),
    },
    c,
  );
  const failed = await runTool(
    {
      name: "edit",
      arguments: JSON.stringify({ path: "folder/a.txt", old_string: "重复", new_string: "$&" }),
    },
    c,
  );
  assert.match(failed.text, /匹配到 2 处/);
  await runTool(
    {
      name: "edit",
      arguments: JSON.stringify({
        path: "folder/a.txt",
        old_string: "重复",
        new_string: "$&",
        replace_all: true,
      }),
    },
    c,
  );
  assert.equal(await fs.readFile(path.join(c.workdir, "folder/a.txt"), "utf8"), "你好\n$&\n$&\n");
  const read = await runTool(
    { name: "read", arguments: JSON.stringify({ path: "folder/a.txt", offset: 2, limit: 1 }) },
    c,
  );
  assert.match(read.text, /2\t\$&/);
  assert.doesNotMatch(read.text, /你好/);
  const shell = await runTool(
    {
      name: "shell",
      arguments: JSON.stringify({
        command:
          process.platform === "win32" ? "Write-Output 'shell works'" : "printf 'shell works'",
      }),
    },
    c,
  );
  assert.match(shell.text, /shell works/);
  assert.match(shell.text, /退出码 0/);
  assert.match(
    (await runTool({ name: "constructor", arguments: JSON.stringify({}) }, c)).text,
    /没有这个工具/,
  );
  assert.equal(
    (await runTool({ name: "read", arguments: JSON.stringify({ path: "absent" }) }, c)).failed,
    true,
  );
});
test("取消 shell 会终止命令，后续副作用不会执行", async (t) => {
  const c = await workspace(t);
  const abort = new AbortController();
  const result = runTool(
    {
      name: "shell",
      arguments: JSON.stringify({
        command:
          process.platform === "win32"
            ? "Start-Sleep -Seconds 1; Set-Content escaped.txt yes"
            : "sleep 1; echo yes > escaped.txt",
      }),
    },
    c,
    abort.signal,
  );
  const rejected = assert.rejects(result, { name: "AbortError" });
  await delay(100);
  abort.abort();
  await rejected;
  await delay(1100);
  await assert.rejects(fs.access(path.join(c.workdir, "escaped.txt")));
});
test("压缩保留完整调用和结果，失败不改写输入", async (t) => {
  const messages = [
    message("旧问题"),
    message("旧答案", "output_text", "assistant"),
    message("新问题"),
    { type: "function_call", name: "read", call_id: "x", arguments: "{}" },
    { type: "function_call_output", call_id: "x", output: "结果" },
    message("新答案", "output_text", "assistant"),
  ];
  const before = structuredClone(messages);
  let requests = 0;
  const url = await modelServer(t, () => {
    requests++;
    if (requests === 1) {
      return { output: [message("摘要", "output_text", "assistant")] };
    }
    return { output: [] };
  });
  const config = { ...defaults(), keep: 2, responsesUrl: url, apiKey: "test" };
  const result = await compact(messages, "fixture-model", config);
  assert.equal(result.end, 2);
  assert.deepEqual(messages, before);
  await assert.rejects(compact(messages, "fixture-model", config), /没有返回摘要/);
  assert.deepEqual(messages, before);
});

test("只有一个待压缩块时跳过，不依赖摘要状态", async (t) => {
  let requests = 0;
  const url = await modelServer(t, () => {
    requests++;
    return { output: [message("不应请求", "output_text", "assistant")] };
  });
  const config = { ...defaults(), keep: 1, responsesUrl: url, apiKey: "test" };
  const messages = [
    message("一个旧块，可能是历史消息或摘要"),
    message("当前问题"),
    { type: "function_call", name: "read", call_id: "x", arguments: "{}" },
    { type: "function_call_output", call_id: "x", output: "结果" },
  ];
  assert.equal(await compact(messages, "fixture-model", config), null);
  assert.equal(requests, 0);
});

test("压缩失败终止运行，保留原始消息并发送一次 error 和 done", async (t) => {
  const input = [message("一"), message("二"), message("三"), message("四")];
  const before = [...input];
  const events = [];
  const url = await modelServer(t, (request) => {
    assert.equal(request.tools.length, 0);
    return { output: [] };
  });
  const result = await run({
    instructions: "测试指令 {{原样保留}}",
    model: "fixture-model",
    messages: input,
    usage: { total_tokens: 1000 },
    config: { ...defaults(), compact_at: 1, keep: 1, responsesUrl: url, apiKey: "test" },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(input, before);
  assert.deepEqual(events, [
    { type: "compact", status: "started" },
    { type: "error", code: "compact_error", error: "压缩没有返回摘要" },
    { type: "done", status: "incomplete", stopReason: "compact_error" },
  ]);
});

test("runner 将无效工具参数作为工具错误返回", async () => {
  const result = await runTool({ name: "read", arguments: "{invalid" }, defaults());
  assert.equal(result.failed, true);
});

test("工具调用缺少 call_id 时终止，不执行工具", async (t) => {
  const config = await workspace(t);
  config.responsesUrl = await modelServer(t, () => ({
    output: [
      {
        type: "function_call",
        id: "fc1",
        name: "write",
        arguments: '{"path":"unexpected.txt","content":"bad"}',
      },
    ],
  }));
  config.apiKey = "test";
  const events = [];
  const result = await run({
    instructions: "指令",
    messages: [message("测试")],
    model: "fixture",
    config,
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, "incomplete");
  assert.deepEqual(
    events.map((event) => event.type),
    ["error", "done"],
  );
  assert.match(events[0].error, /缺少 call_id/);
  await assert.rejects(fs.access(path.join(config.workdir, "unexpected.txt")));
});

test("压缩只看模型 total_tokens，长消息不触发估算", async (t) => {
  for (const totalTokens of [undefined, 0, 9, 10]) {
    let compressions = 0;
    const url = await modelServer(t, (request) => {
      if (request.tools.length === 0) {
        compressions++;
        return { output: [message("摘要", "output_text", "assistant")] };
      }
      const response = { output: [message("回答", "output_text", "assistant")] };
      if (totalTokens !== undefined) {
        response.usage = { total_tokens: totalTokens };
      }
      return response;
    });
    const result = await run({
      instructions: "测试指令 {{原样保留}}",
      model: "fixture-model",
      messages: [message("很长的内容".repeat(10000)), message("二"), message("三"), message("四")],
      usage: { total_tokens: totalTokens },
      config: { ...defaults(), compact_at: 10, keep: 1, responsesUrl: url, apiKey: "test" },
    });
    assert.equal(result.status, "completed");
    assert.equal(compressions, totalTokens === 10 ? 1 : 0);
    assert.equal(result.tokens, totalTokens === undefined ? null : totalTokens);
  }
});

test("最终回答不立即压缩；模型完整块之后单独发送 usage", async (t) => {
  const emitted = [];
  const url = await modelServer(t, (request) => {
    assert.equal(request.tools.length, 5);
    return {
      output: [{ type: "reasoning", summary: [] }, message("回答", "output_text", "assistant")],
      usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
    };
  });
  await run({
    instructions: "测试指令 {{原样保留}}",
    model: "fixture-model",
    messages: [message("一"), message("二"), message("三"), message("四")],
    config: { ...defaults(), compact_at: 10, keep: 1, responsesUrl: url, apiKey: "test" },
    onEvent: (event) => emitted.push(event),
  });
  assert.deepEqual(
    emitted.map((event) => event.type),
    ["reasoning", "message", "usage", "done"],
  );
  assert.equal(emitted[0].usage, undefined);
  assert.deepEqual(emitted[2].usage, { input_tokens: 8, output_tokens: 3, total_tokens: 11 });
});

test("完整模型块原样交付，usage 先于工具执行，循环直接使用传入数组", async (t) => {
  const config = await workspace(t);
  const messages = [message("写文件")];
  const reasoning = { type: "reasoning", id: "r1", encrypted_content: "opaque", summary: [] };
  const call = {
    type: "function_call",
    call_id: "w1",
    name: "write",
    arguments: '{"path":"done.txt","content":"ok"}',
  };
  const received = [];
  let requests = 0;
  config.responsesUrl = await modelServer(t, (request, emit) => {
    assert.deepEqual(request.input, messages);
    assert.equal(request.instructions, "测试指令 {{原样保留}}");
    requests++;
    if (requests === 1) {
      emit({ type: "reasoning", delta: "思考" });
      return { output: [reasoning, call], usage: { total_tokens: 10 } };
    }
    assert.equal(request.input.at(-1).type, "function_call_output");
    emit({ type: "message", delta: "完成" });
    return { output: [message("完成", "output_text", "assistant")] };
  });
  config.apiKey = "test";
  const result = await run({
    instructions: "测试指令 {{原样保留}}",
    model: "fixture-model",
    messages,
    config,
    onEvent: async (event) => {
      received.push(event);
      if (event.item) {
        assert.equal(messages.at(-1), event.item);
      }
      if (event.type === "usage" && requests === 1) {
        await assert.rejects(fs.access(path.join(config.workdir, "done.txt")));
      }
    },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(
    received.map((event) => event.type),
    [
      "reasoning",
      "reasoning",
      "function_call",
      "usage",
      "function_call_output",
      "message",
      "message",
      "usage",
      "done",
    ],
  );
  assert.deepEqual(received[1].item, reasoning);
  assert.deepEqual(received[2].item, call);
  assert.equal(received[7].usage, null);
  assert.equal(await fs.readFile(path.join(config.workdir, "done.txt"), "utf8"), "ok");
  assert.equal(messages.length, 5);
});

test("取消只发送一个 aborted done；超时发送 error 和 incomplete done", async (t) => {
  let requests = 0;
  const url = await modelServer(t, () => {
    requests++;
    return { output: [] };
  });
  for (const reason of [
    new DOMException("取消", "AbortError"),
    new DOMException("超时", "TimeoutError"),
  ]) {
    const controller = new AbortController();
    controller.abort(reason);
    const received = [];
    await run({
      instructions: "测试指令 {{原样保留}}",
      model: "fixture-model",
      messages: [],
      config: { ...defaults(), responsesUrl: url, apiKey: "test" },
      signal: controller.signal,
      onEvent: (event) => received.push(event),
    });
    assert.equal(received.filter((event) => event.type === "done").length, 1);
    if (reason.name === "AbortError") {
      assert.deepEqual(received, [{ type: "done", status: "aborted", stopReason: "aborted" }]);
    } else {
      assert.equal(received[0].type, "error");
      assert.equal(received[0].code, "timeout");
      assert.deepEqual(received.at(-1), {
        type: "done",
        status: "incomplete",
        stopReason: "timeout",
      });
    }
  }
  assert.equal(requests, 0);
});

test("压缩和主请求都使用显式 model，先保存摘要再请求模型", async (t) => {
  const messages = [message("一"), message("二"), message("三"), message("四")];
  const received = [];
  let saved = false;
  const url = await modelServer(t, (request) => {
    assert.equal(request.model, "fixture-model");
    if (!request.tools.length) {
      return { output: [message("摘要", "output_text", "assistant")], usage: { total_tokens: 4 } };
    }
    assert.equal(saved, true);
    assert.deepEqual(request.input[0], received[1].item);
    return { output: [message("回答", "output_text", "assistant")] };
  });
  await run({
    instructions: "测试指令 {{原样保留}}",
    model: "fixture-model",
    messages,
    usage: { total_tokens: 10 },
    config: {
      ...defaults(),
      model: "must-not-use-config-model",
      compact_at: 10,
      keep: 1,
      responsesUrl: url,
      apiKey: "test",
    },
    onEvent: async (event) => {
      received.push(event);
      if (event.type === "compact" && event.status === "completed") {
        assert.equal(messages.length, 4);
        assert.equal(event.start, 0);
        assert.equal(event.end, 3);
        assert.equal(event.item.role, "user");
        assert.deepEqual(event.usage, { total_tokens: 4 });
        await Promise.resolve();
        saved = true;
      }
    },
  });
  assert.deepEqual(
    received.map((event) => event.type),
    ["compact", "compact", "message", "usage", "done"],
  );
});

test("摘要保存失败后停止，不发起下一次模型请求", async (t) => {
  const received = [];
  let requests = 0;
  const messages = [message("一"), message("二"), message("三"), message("四")];
  const url = await modelServer(t, () => {
    requests++;
    return { output: [message("摘要", "output_text", "assistant")] };
  });
  await run({
    instructions: "测试指令 {{原样保留}}",
    model: "fixture-model",
    messages,
    usage: { total_tokens: 10 },
    config: { ...defaults(), compact_at: 10, keep: 1, responsesUrl: url, apiKey: "test" },
    onEvent: (event) => {
      if (event.type === "compact" && event.status === "completed") {
        throw new Error("数据库写入失败");
      }
      received.push(event);
    },
  });
  assert.equal(requests, 1);
  assert.equal(messages.length, 4);
  assert.deepEqual(
    received.map((event) => event.type),
    ["compact", "error", "done"],
  );
});

test("read 拒绝错误范围，shell 相对目录基于配置目录，退出失败有明确状态", async (t) => {
  const config = await workspace(t);
  await fs.mkdir(path.join(config.workdir, "nested"));
  await fs.writeFile(path.join(config.workdir, "nested", "a.txt"), "hello");
  for (const value of [0, -1, "2", 1.5]) {
    for (const field of ["offset", "limit"]) {
      const result = await runTool(
        { name: "read", arguments: JSON.stringify({ path: "nested/a.txt", [field]: value }) },
        config,
      );
      assert.equal(result.failed, true);
      assert.match(result.text, new RegExp(field));
    }
  }
  const command = process.platform === "win32" ? "Get-Content a.txt; exit 7" : "cat a.txt; exit 7";
  const result = await runTool(
    { name: "shell", arguments: JSON.stringify({ command, workdir: "nested" }) },
    config,
  );
  assert.match(result.text, /hello/);
  assert.match(result.text, /退出码 7/);
  assert.equal(result.failed, true);
  const timeout = await runTool(
    {
      name: "shell",
      arguments: JSON.stringify({
        command: process.platform === "win32" ? "Start-Sleep -Seconds 5" : "sleep 5",
      }),
    },
    { ...config, timeout: 0.05 },
  );
  assert.equal(timeout.failed, true);
  assert.match(timeout.text, /超时/);
});
