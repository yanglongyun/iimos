import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.js";
import { message } from "../ai/index.js";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const call = (id, args) => ({
  type: "function_call",
  call_id: id,
  name: "browser",
  arguments: JSON.stringify(args),
});

// 假的浏览器能力：记下收到的命令，按命令回固定结果。真实情况下这些命令经 launcher 转给浏览器插件。
function fakeBrowser() {
  const received = [];
  const page = { tab: 7, title: "示例", url: "https://example.com/", group: "打开示例网站" };
  return {
    received,
    connected: () => true,
    async request(action, args) {
      received.push({ action, args });
      if (action === "tabs") {
        return { tabs: [page] };
      }
      if (args.method === "Page.captureScreenshot") {
        return { data: png.split(",")[1] };
      }
      if (args.params?.expression === "boom") {
        return {
          result: { type: "object" },
          exceptionDetails: {
            text: "Uncaught",
            exception: { description: "ReferenceError: boom is not defined" },
          },
        };
      }
      if (action === "cdp") {
        return { result: { type: "string", value: "页面正文" } };
      }
      return page;
    },
  };
}

test("browser 工具始终提供给模型；插件没连上时返回明确的失败，状态显示未连接", async (t) => {
  let names = [];
  let round = 0;
  let output = null;
  const f = await fixture(t, async (_config, input, tools) => {
    names = tools.map((tool) => tool.name);
    round++;
    if (round === 1) {
      return { output: [call("o", { action: "open", url: "https://example.com/" })] };
    }
    output = input.at(-1);
    return { output: [message("好", "output_text", "assistant")] };
  });
  const chat = await f.connect();
  const id = await f.newSession();
  await f.send(id, "打开示例网站");
  await chat.wait("done");
  assert.deepEqual(names, ["shell", "read", "write", "edit", "browser"]);
  assert.match(JSON.parse(output.output).text, /插件未连接/);
  const status = await (await f.request("/api/status")).json();
  assert.equal(status.browser_connected, false);
});

test("页面操作原样转发 CDP：结果原样返回，脚本出错算工具失败，截图存成图片，命令带着对话标题", async (t) => {
  let round = 0;
  const outputs = [];
  const steps = [
    call("o", { action: "open", url: "https://example.com/" }),
    call("r", {
      action: "cdp",
      tab: 7,
      method: "Runtime.evaluate",
      params: { expression: "document.body.innerText", returnByValue: true },
    }),
    call("x", {
      action: "cdp",
      tab: 7,
      method: "Runtime.evaluate",
      params: { expression: "boom" },
    }),
    call("s", {
      action: "cdp",
      tab: 7,
      method: "Page.captureScreenshot",
      params: { format: "png" },
    }),
    call("t", { action: "tabs" }),
  ];
  const browser = fakeBrowser();
  const f = await fixture(
    t,
    async (_config, input) => {
      round++;
      const last = input.at(-1);
      if (last.type === "function_call_output") {
        outputs.push(last);
      }
      if (round <= steps.length) {
        return { output: [steps[round - 1]] };
      }
      return { output: [message("完成", "output_text", "assistant")] };
    },
    {},
    { browser },
  );
  assert.equal((await (await f.request("/api/status")).json()).browser_connected, true);
  const chat = await f.connect();
  const id = await f.newSession();
  await f.send(id, "打开示例网站");
  await chat.wait("done", (packet) => packet.session_id === id);

  assert.deepEqual(
    browser.received.map((request) => [request.action, request.args.method || ""]),
    [
      ["open", ""],
      ["cdp", "Runtime.evaluate"],
      ["cdp", "Runtime.evaluate"],
      ["cdp", "Page.captureScreenshot"],
      ["tabs", ""],
    ],
  );
  // 没起标题的对话，用第一句话当标签组名。
  assert.deepEqual(browser.received[0].args.session, { id, title: "打开示例网站" });
  assert.deepEqual(browser.received[1].args.params, {
    expression: "document.body.innerText",
    returnByValue: true,
  });

  const results = outputs.map((output) => {
    let text = output.output;
    if (typeof text !== "string") {
      text = text[0].text;
    }
    return JSON.parse(text);
  });
  assert.match(results[0].text, /\[tab 7\] 示例/);
  assert.equal(JSON.parse(results[1].text).result.value, "页面正文");
  assert.equal(results[2].success, false);
  assert.match(results[2].text, /ReferenceError: boom/);
  // 截图作为标准 input_image 交给模型，数据库只存图片地址。
  assert.equal(outputs[3].output[1].type, "input_image");
  assert.equal(outputs[3].output[1].image_url, png);
  const saved = f.runtime.db
    .prepare(
      "SELECT item FROM messages WHERE session_id = ? AND json_extract(item, '$.call_id') = 's' AND json_extract(item, '$.type') = 'function_call_output'",
    )
    .get(id);
  assert.match(JSON.parse(saved.item).output[1].image_url, /^\/api\/images\//);
  assert.match(results[4].text, /\[tab 7\] 示例（打开示例网站）/);
});
