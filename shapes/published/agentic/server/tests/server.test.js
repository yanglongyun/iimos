import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./fixture.js";
import { message } from "../ai/index.js";
const answer = (text) => ({ output: [message(text, "output_text", "assistant")] });
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const tool = (id, name, args) => ({
  type: "function_call",
  call_id: id,
  name,
  arguments: JSON.stringify(args),
});
const count = (f, sql = "SELECT COUNT(*) n FROM messages") => f.runtime.db.prepare(sql).get().n;

// 发一条消息并等到这一轮的 done，返回这一轮这个会话收到的全部事件。
async function run(f, chat, id, text, images) {
  const start = chat.packets.length;
  const response = await f.send(id, text, images);
  assert.equal(response.status, 201);
  await chat.wait("done", (packet) => packet.session_id === id, start);
  return chat.packets.slice(start).filter((packet) => packet.session_id === id);
}

test("鉴权、HTTP 分页、打开对话和页面路由", async (t) => {
  const f = await fixture(t, async () => answer("你好"));
  for (const headers of [{}, { cookie: "agentic_token=wrong" }]) {
    assert.equal((await fetch(f.origin + "/api/events", { headers })).status, 401);
  }
  assert.equal((await fetch(f.origin + "/api/sessions")).status, 401);
  const id = await f.newSession();
  const chat = await f.connect();
  await run(f, chat, id, "你好");
  const opened = await (await f.request(`/api/sessions/${id}`)).json();
  assert.equal(opened.messages.length, 2);
  assert.equal(opened.has_more, false);
  assert.equal(opened.running, false);
  assert.equal(opened.streaming, null);
  const page = await (await f.request(`/api/sessions/${id}/messages?limit=1`)).json();
  assert.equal(page.has_more, true);
  assert.equal(page.messages[0].item.role, "assistant");
  const previous = await (
    await f.request(`/api/sessions/${id}/messages?before=${page.messages[0].id}&limit=1`)
  ).json();
  assert.equal(previous.messages[0].item.role, "user");
  const renamed = await f.request(`/api/sessions/${id}`, "PATCH", { title: " 测试 " });
  assert.equal((await renamed.json()).title, "测试");
  const status = await (await f.request("/api/config")).json();
  assert.equal(status.apiKey, undefined);
  assert.equal(
    (await f.request("/api/config", "PUT", { context_window: 100, compact_at: 100 })).status,
    400,
  );
  assert.equal(
    (await f.request("/api/config", "PUT", { context_window: 100, compact_at: 90 })).status,
    200,
  );
  for (const route of ["/", "/sessions/test", "/settings"]) {
    assert.equal((await fetch(f.origin + route)).status, 200);
  }
  await f.request(`/api/sessions/${id}`, "DELETE");
  assert.equal(count(f), 0);
  assert.equal((await f.request(`/api/sessions/${id}`)).status, 404);
});

test("九种事件原样推送，用户消息开头、done 结尾，完整 item 存库后带 ID", async (t) => {
  let round = 0;
  const f = await fixture(t, async (_config, input) => {
    round++;
    if (round === 1) {
      return {
        output: [
          { type: "reasoning", summary: [{ type: "summary_text", text: "计划" }] },
          tool("write", "write", { path: "a.txt", content: "hello" }),
        ],
        usage: { total_tokens: 42 },
      };
    }
    assert.equal(input.at(-1).type, "function_call_output");
    return answer("完成");
  });
  const chat = await f.connect();
  const id = await f.newSession();
  const packets = await run(f, chat, id, "开始");
  assert.deepEqual(
    packets.map((packet) => packet.type),
    [
      "message",
      "reasoning",
      "function_call",
      "usage",
      "function_call_output",
      "message",
      "usage",
      "done",
    ],
  );
  assert.equal(packets[0].item.role, "user");
  const items = packets.filter((packet) => packet.item);
  assert.equal(items.length, 5);
  assert.ok(items.every((packet) => packet.id > 0 && packet.created_at > 0));
  assert.equal(packets.at(-1).status, "completed");
  // usage 附在这次模型响应的最后一项上。
  const call = f.runtime.db.prepare("SELECT usage FROM messages WHERE id = ?").get(items[2].id);
  assert.equal(JSON.parse(call.usage).total_tokens, 42);
  assert.equal(await fs.readFile(path.join(f.root, "a.txt"), "utf8"), "hello");
  assert.equal(count(f), 5);
});

test("断开推送不停止执行；打开正在运行的对话带流式文字；同会话不能同时开始两轮", async (t) => {
  let release;
  let requests = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async (_config, _input, _tools, _instructions, emit) => {
    requests++;
    emit({ type: "message", delta: "生成中" });
    await gate;
    return answer("最终回答");
  });
  const id = await f.newSession();
  const first = await f.connect();
  assert.equal((await f.send(id, "问题")).status, 201);
  await first.wait("message", (packet) => packet.delta === "生成中");
  first.close();
  const opened = await (await f.request(`/api/sessions/${id}`)).json();
  assert.equal(opened.running, true);
  assert.equal(opened.streaming.text, "生成中");
  assert.equal((await f.send(id, "再问")).status, 409);
  const list = await (await f.request("/api/sessions")).json();
  assert.equal(list.sessions[0].running, true);
  const next = await f.connect();
  release();
  assert.equal((await next.wait("done")).status, "completed");
  assert.equal(requests, 1);
  assert.equal(count(f), 2);
});

test("停止等待模型清理后才返回；正在运行的对话不能删除", async (t) => {
  let aborted = false;
  const f = await fixture(t, async (_config, input, _tools, _instructions, emit, signal) => {
    if (input[0].content[0].text === "快") {
      return answer("完成");
    }
    emit({ type: "message", delta: "等待" });
    await new Promise((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          resolve();
        },
        { once: true },
      ),
    );
    return answer("不保存");
  });
  const chat = await f.connect();
  const id = await f.newSession();
  await f.send(id, "慢");
  await chat.wait("message", (packet) => packet.delta === "等待");
  assert.equal((await f.request(`/api/sessions/${id}`, "DELETE")).status, 409);
  // 别的会话可以同时运行。
  await run(f, chat, await f.newSession(), "快");
  const stopped = await f.request(`/api/sessions/${id}/run`, "DELETE");
  assert.deepEqual(await stopped.json(), { stopped: true });
  const done = await chat.wait("done", (packet) => packet.session_id === id);
  assert.equal(done.status, "aborted");
  await delay(30);
  assert.equal(aborted, true);
  assert.equal(count(f, `SELECT COUNT(*) n FROM messages WHERE session_id = '${id}'`), 1);
  assert.deepEqual(await (await f.request(`/api/sessions/${id}/run`, "DELETE")).json(), {
    stopped: false,
  });
});

test("压缩读取最新实际 usage；摘要入库后才继续请求；不回退更早 usage", async (t) => {
  let requests = 0;
  let compact = 0;
  const f = await fixture(
    t,
    async (_config, input, tools) => {
      if (!tools?.length) {
        compact++;
        return answer("测试摘要");
      }
      requests++;
      if (requests === 3) {
        assert.equal(count(f, "SELECT COUNT(*) n FROM compactions"), 1);
        assert.match(input[0].content[0].text, /测试摘要/);
      }
      if (requests <= 2) {
        return { ...answer("第一次"), usage: { total_tokens: 100 } };
      }
      return answer("后续无 usage");
    },
    { compact_at: 10, keep: 1 },
  );
  const chat = await f.connect();
  const id = await f.newSession();
  for (let index = 0; index < 4; index++) {
    await run(f, chat, id, `消息${index}`);
  }
  assert.equal(compact, 1);
  assert.equal(requests, 4);
  assert.equal(count(f), 8);
  const completed = chat.packets.find(
    (packet) => packet.type === "compact" && packet.status === "completed",
  );
  assert.ok(completed.id > 0 && completed.message_id > 0);
  assert.match(completed.summary, /测试摘要/);
});

test("工具轮次使用最新 usage 连续压缩，后续失败保留已存的消息", async (t) => {
  let round = 0;
  const f = await fixture(
    t,
    async (_config, _input, tools) => {
      if (!tools?.length) {
        return answer("摘要");
      }
      round++;
      if (round <= 4) {
        return {
          output: [tool(`call${round}`, "write", { path: `${round}.txt`, content: "ok" })],
          usage: { total_tokens: 100 },
        };
      }
      throw new Error("模型故障");
    },
    { compact_at: 10, keep: 1 },
  );
  const chat = await f.connect();
  const id = await f.newSession();
  const packets = await run(f, chat, id, "开始");
  assert.equal(packets.at(-1).status, "incomplete");
  assert.equal(count(f), 9);
  assert.ok(count(f, "SELECT COUNT(*) n FROM compactions") >= 2);
});

test("不完整模型响应不保存完整块、不执行工具", async (t) => {
  const f = await fixture(t, async () => ({
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [tool("w", "write", { path: "bad.txt", content: "no" })],
  }));
  const chat = await f.connect();
  const packets = await run(f, chat, await f.newSession(), "开始");
  assert.equal(packets.at(-1).status, "incomplete");
  assert.equal(
    packets.some((packet) => packet.type === "function_call"),
    false,
  );
  assert.equal(count(f), 1);
  await assert.rejects(fs.access(path.join(f.root, "bad.txt")));
});

test("存库失败时这一轮以 error 和 incomplete 结束", async (t) => {
  const f = await fixture(t, async () => answer("答案"));
  const id = await f.newSession();
  const chat = await f.connect();
  f.runtime.db.exec(
    "CREATE TRIGGER reject_assistant BEFORE INSERT ON messages WHEN json_extract(NEW.item, '$.role') = 'assistant' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  const packets = await run(f, chat, id, "开始");
  assert.match(packets.find((packet) => packet.type === "error").error, /test failure/);
  assert.equal(packets.at(-1).status, "incomplete");
  assert.equal(count(f), 1);
  assert.equal((await (await f.request(`/api/sessions/${id}`)).json()).running, false);
});

test("图片单独上传最多五张，地址校验，数据库和事件没有 base64，删除清理", async (t) => {
  const f = await fixture(t, async (_config, input) => {
    const images = input[0].content.filter((part) => part.type === "input_image");
    assert.equal(images.length, 5);
    assert.equal(images[0].image_url, png);
    return answer("看到了");
  });
  const id = await f.newSession();
  const urls = [];
  for (let index = 0; index < 5; index++) {
    const response = await f.request(`/api/sessions/${id}/images`, "POST", { image: png });
    assert.equal(response.status, 201);
    urls.push((await response.json()).url);
  }
  for (const images of [
    null,
    "invalid",
    [...urls, urls[0]],
    [png],
    // 只认上传接口给出的地址，文件不在就拒绝。
    ["/api/images/00000000-0000-0000-0000-000000000000.png"],
  ]) {
    assert.equal((await f.send(id, "看图", images)).status, 400);
  }
  const chat = await f.connect();
  const packets = await run(f, chat, id, "", urls);
  assert.equal(JSON.stringify(packets).includes("base64"), false);
  await run(f, chat, id, "再看一次");
  assert.equal(
    f.runtime.db.prepare("SELECT item FROM messages LIMIT 1").get().item.includes("base64"),
    false,
  );
  assert.equal((await f.request(urls[0])).status, 200);
  await f.request(`/api/sessions/${id}`, "DELETE");
  assert.deepEqual(await fs.readdir(f.p.images), []);
});

test("上传校验：只接受 10 MiB 以内的 PNG、JPEG、GIF、WebP", async (t) => {
  const f = await fixture(t, async () => answer("ok"));
  const id = await f.newSession();
  for (const image of [
    null,
    "data:image/png;base64,aGVsbG8=",
    png.replace("image/png", "image/jpeg"),
    "data:image/svg+xml;base64,PHN2Zy8+",
  ]) {
    assert.equal((await f.request(`/api/sessions/${id}/images`, "POST", { image })).status, 400);
  }
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 1);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(
    (
      await f.request(`/api/sessions/${id}/images`, "POST", {
        image: `data:image/png;base64,${bytes.toString("base64")}`,
      })
    ).status,
    413,
  );
});

test("工具图片保持标准 output，模型请求时还原 base64，历史重新读取仍可用", async (t) => {
  let round = 0;
  const f = await fixture(t, async (_config, input) => {
    round++;
    if (round === 1) {
      return { output: [tool("read-image", "read", { path: "sample.png" })] };
    }
    const output = input.find((item) => item.type === "function_call_output");
    assert.equal(output.output[1].image_url, png);
    return answer("看过了");
  });
  await fs.writeFile(path.join(f.root, "sample.png"), Buffer.from(png.split(",")[1], "base64"));
  const chat = await f.connect();
  const id = await f.newSession();
  const packets = await run(f, chat, id, "读图");
  assert.equal(JSON.stringify(packets).includes("base64"), false);
  await fs.unlink(path.join(f.root, "sample.png"));
  await run(f, chat, id, "继续");
  const output = f.runtime.db
    .prepare(
      "SELECT item FROM messages WHERE json_extract(item, '$.type') = 'function_call_output'",
    )
    .get();
  const image = JSON.parse(output.item).output[1].image_url;
  assert.equal((await f.request(image)).status, 200);
});

test("工具跑到一半停止，给没有结果的调用补一条“已停止”", async (t) => {
  let round = 0;
  const f = await fixture(t, async (_config, input) => {
    round++;
    if (round === 1) {
      return {
        output: [
          tool("image", "read", { path: "sample.png" }),
          tool("wait", "shell", { command: "sleep 30" }),
        ],
        usage: { total_tokens: 8 },
      };
    }
    // 下次请求时调用和结果成对。
    const outputs = input.filter((item) => item.type === "function_call_output");
    assert.deepEqual(
      outputs.map((item) => item.call_id),
      ["image", "wait"],
    );
    return answer("继续");
  });
  await fs.writeFile(path.join(f.root, "sample.png"), Buffer.from(png.split(",")[1], "base64"));
  const chat = await f.connect();
  const id = await f.newSession();
  await f.send(id, "开始");
  await chat.wait("function_call_output", (packet) => packet.item.call_id === "image");
  await f.request(`/api/sessions/${id}/run`, "DELETE");
  const filled = await chat.wait(
    "function_call_output",
    (packet) => packet.item.call_id === "wait",
  );
  assert.deepEqual(JSON.parse(filled.item.output), { success: false, text: "已停止" });
  assert.equal(count(f), 5);
  // 已存下的工具结果引用的图片保留。
  assert.equal((await fs.readdir(f.p.images)).length, 1);
  assert.equal((await run(f, chat, id, "接着来")).at(-1).status, "completed");
});

test("对话置顶：置顶组在前且新置顶排最前，拖拽排序原子保存，删除对话清掉置顶", async (t) => {
  const f = await fixture(t, async () => answer("完成"));
  const a = await f.newSession();
  const b = await f.newSession();
  const c = await f.newSession();
  const list = async () => (await (await f.request("/api/sessions")).json()).sessions;

  const pinned = await (await f.request(`/api/sessions/${a}`, "PATCH", { pinned: true })).json();
  assert.equal(pinned.pinned, true);
  await f.request(`/api/sessions/${c}`, "PATCH", { pinned: true });
  let sessions = await list();
  assert.deepEqual(
    sessions.map((session) => [session.id, session.pinned]),
    [
      [c, true],
      [a, true],
      [b, false],
    ],
  );

  assert.equal((await f.request("/api/sessions/pins", "PUT", { ids: [a, c] })).status, 200);
  sessions = await list();
  assert.deepEqual(
    sessions.filter((session) => session.pinned).map((session) => session.id),
    [a, c],
  );
  // 顺序必须恰好覆盖全部置顶对话，不能夹带未置顶的。
  assert.equal((await f.request("/api/sessions/pins", "PUT", { ids: [a] })).status, 409);
  assert.equal((await f.request("/api/sessions/pins", "PUT", { ids: [a, b] })).status, 409);
  assert.equal((await f.request(`/api/sessions/${a}`, "PATCH", { pinned: "yes" })).status, 400);

  await f.request(`/api/sessions/${c}`, "PATCH", { pinned: false });
  await f.request(`/api/sessions/${a}`, "DELETE");
  sessions = await list();
  assert.deepEqual(
    sessions.map((session) => session.pinned),
    [false, false],
  );
  assert.equal(count(f, "SELECT COUNT(*) AS n FROM sessions WHERE pin IS NOT NULL"), 0);
});

test("会话列表分页：第一页是全部置顶加最近 50 个，之后只翻未置顶的，不重不漏", async (t) => {
  const f = await fixture(t, async () => answer("完成"));
  const ids = [];
  for (let index = 0; index < 55; index++) {
    ids.push(await f.newSession());
  }
  await f.request(`/api/sessions/${ids[0]}`, "PATCH", { pinned: true });
  await f.request(`/api/sessions/${ids[54]}`, "PATCH", { pinned: true });
  const first = await (await f.request("/api/sessions")).json();
  assert.equal(first.has_more, true);
  assert.equal(first.sessions.length, 52);
  assert.deepEqual(
    first.sessions.slice(0, 2).map((session) => session.id),
    [ids[54], ids[0]],
  );
  const last = first.sessions.at(-1);
  const second = await (
    await f.request(`/api/sessions?before=${last.updated_at}&before_id=${last.id}`)
  ).json();
  assert.equal(second.has_more, false);
  assert.equal(second.sessions.length, 3);
  assert.ok(second.sessions.every((session) => !session.pinned));
  const seen = new Set([...first.sessions, ...second.sessions].map((session) => session.id));
  assert.equal(seen.size, 55);
  assert.equal((await f.request("/api/sessions?before=abc")).status, 400);
});
