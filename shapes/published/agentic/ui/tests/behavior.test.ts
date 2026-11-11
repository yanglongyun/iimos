import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, mergeMessages, type RawMessage } from "../src/thread/thread";
import {
  send,
  retrySend,
  useThread,
  loadStatus,
  loadThreads,
  openThread,
  loadOlder,
  reorderPins,
  stopRun,
  pinThread,
  removeThread,
  renameThread,
  threadTitle,
  receiveEvent,
  init,
  dispose,
} from "../src/thread/store";
import { copyText } from "../src/lib/clipboard";

const call: RawMessage = {
  id: 1,
  item: { type: "function_call", call_id: "c1", name: "read", arguments: '{"path":"a.txt"}' },
};
const output: RawMessage = {
  id: 2,
  item: {
    type: "function_call_output",
    call_id: "c1",
    output: JSON.stringify({ success: true, text: '{"error":"ordinary file content"}' }),
  },
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("跨页调用与结果合并成一行，刷新保持稳定标识，文件 error 字段不表示工具失败", () => {
  const latest = buildRows([output]);
  const rows = buildRows(mergeMessages([call], [output]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, latest[0].key);
  assert.equal(rows[0].name, "read");
  assert.equal(rows[0].failed, false);
  assert.equal(rows[0].result, '{"error":"ordinary file content"}');
  const failed: RawMessage = {
    ...output,
    item: {
      type: "function_call_output",
      call_id: "c1",
      output: '{"success":false,"text":"退出码 1"}',
    },
  };
  assert.equal(buildRows([call, failed])[0].failed, true);
});
test("压缩记录按覆盖位置显示，加载更早历史后不重复", () => {
  const summaries = [{ id: 1, message_id: 2, summary: "摘要", created_at: 10 }];
  const last: RawMessage = {
    id: 3,
    item: { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
  };
  assert.deepEqual(
    buildRows([last], summaries).map((row) => row.key),
    ["compact:1", "message:3"],
  );
  assert.deepEqual(
    buildRows([call, output, last], summaries).map((row) => row.key),
    ["tool:c1", "compact:1", "message:3"],
  );
});
test("发送前检查失败不接管草稿、不发请求", (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => {
    throw new Error("不应该发送");
  };
  useThread.setState({ ready: true, busy: false, status: null, messages: [] });
  assert.equal(send("保留这段草稿"), false);
  assert.deepEqual(useThread.getState().messages, []);
  assert.equal(useThread.getState().busy, false);
});
test("状态和会话加载失败返回失败，保留已加载数据", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const threads = useThread.getState().threads;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await loadStatus(), false);
  assert.equal(await loadThreads(), false);
  assert.equal(useThread.getState().threads, threads);
});
test("复制等待剪贴板完成，拒绝时返回失败", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    if (descriptor) {
      Object.defineProperty(globalThis, "navigator", descriptor);
    }
  });
  let resolve: () => void = () => {};
  const pending = new Promise<void>((finish) => {
    resolve = finish;
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: () => pending } },
  });
  let finished = false;
  const copying = copyText("hello").then((value) => {
    finished = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  resolve();
  assert.equal(await copying, true);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    },
  });
  assert.equal(await copyText("hello"), false);
});

test("九种事件按数据库 ID 接管发送中和流式行，done 收尾；打开对话恢复流式文字", async (t) => {
  const user = { type: "message", role: "user", content: [{ type: "input_text", text: "问" }] };
  useThread.setState({
    currentId: "chat",
    ready: true,
    busy: true,
    notes: [],
    compactions: [],
    messages: [{ id: 0, key: "mine", item: user as RawMessage["item"], sending: true }],
  });
  receiveEvent({ type: "message", session_id: "chat", item: user as never, id: 1, created_at: 1 });
  assert.deepEqual(
    useThread.getState().messages.map((entry) => [entry.key, entry.id, entry.sending]),
    [["mine", 1, undefined]],
  );
  receiveEvent({ type: "message", session_id: "chat", delta: "部分" });
  const streamingKey = useThread.getState().messages.at(-1)?.key;
  receiveEvent({
    type: "function_call",
    session_id: "chat",
    ...call,
    id: 2,
    created_at: 2,
  } as never);
  const answer = {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "部分答" }],
  };
  receiveEvent({
    type: "message",
    session_id: "chat",
    item: answer as never,
    id: 3,
    created_at: 3,
  });
  // 重复推送同一条不会多出一行；别的会话的事件不进当前对话。
  receiveEvent({
    type: "message",
    session_id: "chat",
    item: answer as never,
    id: 3,
    created_at: 3,
  });
  receiveEvent({
    type: "message",
    session_id: "other",
    item: answer as never,
    id: 9,
    created_at: 9,
  });
  const messages = useThread.getState().messages;
  assert.deepEqual(
    messages.map((entry) => entry.id),
    [1, 2, 3],
  );
  assert.equal(messages.find((entry) => entry.id === 3)?.key, streamingKey);
  receiveEvent({
    type: "compact",
    status: "completed",
    session_id: "chat",
    id: 7,
    message_id: 3,
    summary: "摘要",
    created_at: 4,
  });
  assert.equal(useThread.getState().compactions[0].id, 7);
  receiveEvent({ type: "error", session_id: "chat", code: "http_500", error: "失败" });
  receiveEvent({ type: "done", session_id: "chat", status: "incomplete" });
  assert.equal(useThread.getState().busy, false);
  assert.equal(useThread.getState().notes[0].content, "失败");

  t.mock.method(globalThis, "fetch", async () =>
    json({
      running: true,
      messages: [{ id: 1, item: user, created_at: 1 }],
      has_more: false,
      compactions: [],
      streaming: { text: "恢复中的回答", reasoning: "" },
    }),
  );
  await openThread("chat", true);
  assert.equal(useThread.getState().busy, true);
  receiveEvent({ type: "message", session_id: "chat", delta: "继续" });
  assert.equal(buildRows(useThread.getState().messages).at(-1)?.content, "恢复中的回答继续");
});

test("发消息和停止走 HTTP；断线重连后重新拉取当前对话", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const sources: FakeEventSource[] = [];
  class FakeEventSource {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((message: { data: string }) => void) | null = null;
    constructor() {
      sources.push(this);
    }
    close() {}
  }
  const requests: string[] = [];
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: FakeEventSource });
  globalThis.fetch = async (url, options) => {
    const route = `${options?.method || "GET"} ${String(url)}`;
    requests.push(route);
    if (route.endsWith("/status")) {
      return json({ model: "test", model_ready: true, workdir: "/tmp" });
    }
    if (route === "GET /api/sessions") {
      return json({ sessions: [], has_more: false });
    }
    if (route.startsWith("POST") && route.endsWith("/messages")) {
      return json({ id: 5, created_at: 5 }, 201);
    }
    if (route.startsWith("DELETE")) {
      return json({ stopped: true });
    }
    return json({
      running: false,
      messages: [],
      has_more: false,
      compactions: [],
      streaming: null,
    });
  };
  t.after(() => {
    dispose();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: originalEventSource,
    });
  });
  await init();
  sources[0].onopen?.();
  await openThread("socket-chat", true);
  assert.equal(send("你好"), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(useThread.getState().messages.at(-1)?.id, 5);
  assert.equal(useThread.getState().busy, true);
  assert.ok(requests.includes("POST /api/sessions/socket-chat/messages"));
  await stopRun();
  assert.ok(requests.includes("DELETE /api/sessions/socket-chat/run"));

  // EventSource 断开后自己重连，连上时重新拉取当前对话。
  sources[0].onerror?.();
  assert.equal(useThread.getState().online, false);
  const opened = requests.filter((route) => route === "GET /api/sessions/socket-chat").length;
  sources[0].onopen?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(useThread.getState().online, true);
  assert.equal(
    requests.filter((route) => route === "GET /api/sessions/socket-chat").length,
    opened + 1,
  );
  assert.equal(sources.length, 1);
});

test("置顶顺序：载入、置顶、删除都同步，排序保存失败回滚", async (t) => {
  const thread = (id: string, pinned: boolean) => ({
    id,
    title: id,
    preview: "",
    running: false,
    pinned,
    created_at: 1,
    updated_at: 1,
  });
  t.mock.method(globalThis, "fetch", async (url: unknown, options?: RequestInit) => {
    if (options?.method === "PUT") {
      return json({ error: "置顶对话已变化，请刷新后再排序" }, 409);
    }
    if (options?.method === "PATCH") {
      return json(thread("c", true));
    }
    if (options?.method === "DELETE") {
      return json({ deleted: String(url).split("/").at(-1) });
    }
    return json({
      sessions: [thread("a", true), thread("b", true), thread("c", false)],
      has_more: false,
    });
  });
  await loadThreads();
  assert.deepEqual(useThread.getState().pinOrder, ["a", "b"]);
  await pinThread("c", true);
  assert.deepEqual(useThread.getState().pinOrder, ["c", "a", "b"]);
  // 运行状态的变化不影响置顶。
  receiveEvent({ type: "done", session_id: "a", status: "completed" });
  assert.deepEqual(useThread.getState().pinOrder, ["c", "a", "b"]);
  await removeThread("c");
  assert.deepEqual(useThread.getState().pinOrder, ["a", "b"]);
  assert.equal(
    useThread.getState().threads.some((entry) => entry.id === "c"),
    false,
  );
  await reorderPins(["b", "a"]);
  assert.deepEqual(useThread.getState().pinOrder, ["a", "b"]);
});

test("列表只由列表接口加载：打开对话、改名、置顶都不会把标题变成默认的“对话”", async (t) => {
  const row = {
    id: "p1",
    title: "",
    preview: "第一句话",
    running: false,
    pinned: false,
    created_at: 1,
    updated_at: 1,
  };
  t.mock.method(globalThis, "fetch", async (url: unknown, options?: RequestInit) => {
    if (String(url) === "/api/sessions") {
      return json({ sessions: [row], has_more: false });
    }
    if (options?.method === "PATCH") {
      return json({});
    }
    return json({
      messages: [],
      has_more: false,
      compactions: [],
      running: false,
      streaming: null,
    });
  });
  const title = () => threadTitle(useThread.getState().threads.find((entry) => entry.id === "p1"));
  await loadThreads();
  await openThread("p1", true);
  assert.equal(title(), "第一句话");
  await pinThread("p1", true);
  assert.equal(title(), "第一句话");
  assert.deepEqual(useThread.getState().pinOrder, ["p1"]);
  await renameThread("p1", "新标题");
  assert.equal(title(), "新标题");
});

test("最终回答带上这次响应的 total_tokens：历史消息直接读，实时 usage 挂到最后一条已存的消息", () => {
  const answer = (id: number, text: string) => ({
    id,
    item: {
      type: "message" as const,
      role: "assistant" as const,
      content: [{ type: "output_text" as const, text }],
    },
  });
  // 历史：usage 在这条消息上。
  const history = buildRows([{ ...answer(1, "旧回答"), usage: { total_tokens: 1234 } }]);
  assert.equal(history[0].tokens, 1234);

  // 实时：完整回答先到，usage 事件后到。
  useThread.setState({ currentId: "live", messages: [], busy: true, ready: true });
  receiveEvent({
    type: "message",
    session_id: "live",
    ...answer(2, "新回答"),
    created_at: 2,
  } as never);
  assert.equal(buildRows(useThread.getState().messages)[0].tokens, undefined);
  receiveEvent({ type: "usage", session_id: "live", usage: { total_tokens: 5678 } });
  assert.equal(buildRows(useThread.getState().messages)[0].tokens, 5678);
  // 模型没返回用量时不显示。
  receiveEvent({ type: "usage", session_id: "live", usage: null });
  assert.equal(buildRows(useThread.getState().messages)[0].tokens, 5678);
});
