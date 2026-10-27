import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../index.js";
import { defaults, paths } from "../config.js";
import modelServer from "./model.js";

// 启动一个带假模型的本地服务。respond 决定假模型每次请求的返回。
export async function fixture(t, respond, overrides = {}, { browser } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-test-"));
  const p = paths({ IIMOS_DATA: root });
  const config = {
    ...defaults(),
    apiKey: "test-model-key",
    workdir: root,
    ...overrides,
  };
  config.responsesUrl = await modelServer(t, (request, emit, signal) =>
    respond(config, request.input, request.tools, request.instructions, emit, signal),
  );
  const token = "test-access-token-123456";
  const runtime = createServer({ p, config, token, browser });
  const origin = await runtime.listen(0);
  t.after(async () => {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const headers = {
    cookie: `agentic_token=${token}`,
    "content-type": "application/json",
  };
  const request = (route, method = "GET", data) =>
    fetch(origin + route, {
      method,
      headers,
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  const newSession = async () => {
    const response = await request("/api/sessions", "POST", {});
    assert.equal(response.status, 201);
    return (await response.json()).id;
  };
  const send = (id, text, images) =>
    request(`/api/sessions/${id}/messages`, "POST", { text, images });
  const connect = () => events(t, origin + "/api/events", headers);
  return { root, p, config, runtime, origin, headers, request, newSession, send, connect };
}

// 事件通道客户端：读 SSE，记录收到的全部事件，可以等待某个事件出现。
export async function events(t, address, headers) {
  const controller = new AbortController();
  const response = await fetch(address, { headers, signal: controller.signal });
  assert.equal(response.status, 200);
  const packets = [];
  const listeners = new Set();
  t.after(() => controller.abort());
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (block.startsWith("data: ")) {
            const packet = JSON.parse(block.slice(6));
            packets.push(packet);
            for (const listener of listeners) {
              listener(packet);
            }
          }
          index = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // 测试结束或主动断开时中止读取。
    }
  })();

  function wait(type, predicate = () => true, start = 0) {
    const found = packets.slice(start).find((packet) => packet.type === type && predicate(packet));
    if (found) {
      return Promise.resolve(found);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(listener);
        reject(new Error(`等待 ${type} 超时: ${JSON.stringify(packets.slice(-3))}`));
      }, 10000);
      function listener(packet) {
        if (packet.type === type && predicate(packet)) {
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(packet);
        }
      }
      listeners.add(listener);
    });
  }

  return { packets, wait, close: () => controller.abort() };
}
