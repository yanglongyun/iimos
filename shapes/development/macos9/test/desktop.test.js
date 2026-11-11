import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { desktopFiles } from "../server/desktop.js";
import { startServer } from "../server/index.js";

const require = createRequire(
  new URL("../../../../client/package.json", import.meta.url),
);
const { transform } = require("esbuild");
const source = fs.readFileSync(
  new URL("../ui/src/windowing.ts", import.meta.url),
  "utf8",
);
const { code } = await transform(source, { loader: "ts", format: "esm" });
const { initialDesktop, activate, hideWindow, fit, resizeRect } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "macos9-test-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const workspace = path.join(base, "workspace");
  const data = path.join(base, "data");
  fs.mkdirSync(workspace);
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(workspace, "hello.txt"), "真实文件");
  fs.mkdirSync(path.join(workspace, "folder"));
  return { base, workspace, data, desktop: desktopFiles(workspace, data) };
}

test("切换、最小化、关闭窗口后，焦点落回最上层可见窗口；重新打开保留位置", () => {
  let state = initialDesktop({ width: 1280, height: 768 });
  state = activate(state, "notepad");
  state = activate(state, "computer");
  state = activate(state, "chat");
  assert.deepEqual(
    state.tasks,
    ["chat", "notepad", "computer"],
    "焦点切换不改变应用列表位置",
  );
  state = activate(state, "notepad");
  state = activate(state, "computer");
  state = hideWindow(state, "computer", false);
  assert.equal(state.active, "notepad");
  state = hideWindow(state, "notepad", true);
  assert.equal(state.active, "chat");
  assert.deepEqual(state.tasks, ["chat", "computer"]);
  const rect = state.windows.computer.rect;
  state = activate(state, "computer");
  assert.equal(state.active, "computer");
  assert.equal(state.windows.computer.minimized, false);
  assert.deepEqual(state.windows.computer.rect, rect);
  assert.equal(new Set(state.order).size, state.order.length);
});

test("窗口在屏幕缩小时仍可操作；向四周缩放不会越界或小于最小尺寸", () => {
  const bounds = { width: 760, height: 528 };
  assert.deepEqual(fit({ x: 800, y: 700, width: 900, height: 800 }, bounds), {
    x: 0,
    y: 0,
    width: 760,
    height: 528,
  });
  const rect = { x: 100, y: 100, width: 400, height: 300 };
  const minimum = { width: 300, height: 200 };
  assert.deepEqual(resizeRect(rect, 1000, 1000, "nw", bounds, minimum), {
    x: 200,
    y: 200,
    width: 300,
    height: 200,
  });
  assert.deepEqual(resizeRect(rect, 1000, 1000, "se", bounds, minimum), {
    x: 100,
    y: 100,
    width: 660,
    height: 428,
  });
  assert.deepEqual(resizeRect(rect, -1000, -1000, "nw", bounds, minimum), {
    x: 0,
    y: 0,
    width: 500,
    height: 400,
  });
});

test("便笺保存到独立文档目录，重开可读，并拒绝覆盖另一个窗口的新内容", (t) => {
  const { desktop, data, workspace } = fixture(t);
  const initial = desktop.note();
  const saved = desktop.saveNote({
    text: "今天的计划\n完成 iimos 9",
    version: initial.version,
  });
  assert.equal(
    fs.readFileSync(path.join(data, "macos9/documents/note.txt"), "utf8"),
    saved.text,
  );
  assert.deepEqual(desktopFiles(workspace, data).note(), saved);
  assert.throws(
    () => desktop.saveNote({ text: "旧窗口的修改", version: initial.version }),
    { status: 409 },
  );
  assert.deepEqual(desktop.note(), saved);
  assert.ok(!fs.existsSync(path.join(workspace, "note.txt")));
});

test("待办保存在我的文档里，重开可读，并拒绝覆盖另一个窗口的新内容", (t) => {
  const { desktop, data, workspace } = fixture(t);
  const initial = desktop.todos();
  assert.deepEqual(initial.items, []);
  const saved = desktop.saveTodos({
    items: [
      { id: "a", text: "  写 iimos 9  ", done: false },
      { id: "b", text: "发布", done: true },
    ],
    version: initial.version,
  });
  assert.deepEqual(saved.items, [
    { id: "a", text: "写 iimos 9", done: false },
    { id: "b", text: "发布", done: true },
  ]);
  assert.deepEqual(desktopFiles(workspace, data).todos(), saved);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(data, "macos9/documents/todos.json"), "utf8"),
    ).items.length,
    2,
  );
  assert.throws(
    () => desktop.saveTodos({ items: [], version: initial.version }),
    { status: 409 },
  );
  assert.deepEqual(desktop.todos(), saved);
  assert.throws(
    () =>
      desktop.saveTodos({
        items: [
          { id: "a", text: "重复标识", done: false },
          { id: "a", text: "重复标识", done: false },
        ],
        version: saved.version,
      }),
    { status: 400 },
  );
  assert.throws(
    () =>
      desktop.saveTodos({
        items: [{ id: "c", text: "   ", done: false }],
        version: saved.version,
      }),
    { status: 400 },
  );
  assert.ok(!fs.existsSync(path.join(workspace, "todos.json")));
});

test("浏览真实文件并预览文本；路径越界、符号链接越界和二进制不可预览", async (t) => {
  const { desktop, workspace, base } = fixture(t);
  const list = await desktop.list("workspace", "");
  assert.deepEqual(
    list.entries.map((entry) => entry.name),
    ["folder", "hello.txt"],
  );
  assert.equal(desktop.read("workspace", "hello.txt").text, "真实文件");
  fs.writeFileSync(path.join(base, "private.txt"), "outside");
  fs.symlinkSync(
    path.join(base, "private.txt"),
    path.join(workspace, "link.txt"),
  );
  fs.writeFileSync(path.join(workspace, "binary"), Buffer.from([0, 1, 2]));
  fs.writeFileSync(
    path.join(workspace, "large"),
    Buffer.alloc(512 * 1024 + 1, 65),
  );
  assert.throws(() => desktop.read("workspace", "../private.txt"), {
    status: 403,
  });
  assert.throws(() => desktop.read("workspace", "link.txt"), { status: 403 });
  assert.throws(() => desktop.read("workspace", "binary"), { status: 415 });
  assert.throws(() => desktop.read("workspace", "large"), { status: 413 });
  assert.throws(() => desktop.read("unknown", ""), { status: 400 });
});

test("桌面接口均需本机令牌，便笺与其他形态的数据分开，模型配置仍共用", async (t) => {
  const { workspace, data } = fixture(t);
  fs.writeFileSync(path.join(data, "conversation.json"), '{"other":"keep"}');
  fs.writeFileSync(
    path.join(data, "config.json"),
    JSON.stringify({
      model: "shared-model",
      apiKey: "test-key",
      responsesUrl: "https://example.com/responses",
    }),
  );
  const server = await startServer({ workspace, data });
  t.after(() => server.close());
  const origin = new URL(server.url).origin;
  for (const route of [
    "/api/note",
    "/api/todos",
    "/api/files?volume=workspace",
    "/api/file?volume=workspace&path=hello.txt",
  ]) {
    assert.equal((await fetch(origin + route)).status, 401);
  }
  const headers = {
    "x-iimos-token": server.token,
    "content-type": "application/json",
  };
  const note = await (await fetch(origin + "/api/note", { headers })).json();
  const saved = await fetch(origin + "/api/note", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...note, text: "HTTP 保存的便笺" }),
  });
  assert.equal(saved.status, 200);
  const state = await (await fetch(origin + "/api/state", { headers })).json();
  assert.equal(state.config.model, "shared-model");
  assert.equal(state.items.length, 0);
  assert.equal(
    fs.readFileSync(path.join(data, "conversation.json"), "utf8"),
    '{"other":"keep"}',
  );
  assert.equal(
    (await (await fetch(origin + "/api/note", { headers })).json()).text,
    "HTTP 保存的便笺",
  );
  const todos = await (await fetch(origin + "/api/todos", { headers })).json();
  assert.deepEqual(todos.items, []);
  const todoSaved = await fetch(origin + "/api/todos", {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...todos,
      items: [{ id: "x", text: "HTTP 保存的待办", done: false }],
    }),
  });
  assert.equal(todoSaved.status, 200);
  assert.equal(
    fs
      .readFileSync(path.join(data, "macos9/documents/todos.json"), "utf8")
      .includes("HTTP 保存的待办"),
    true,
  );
});
