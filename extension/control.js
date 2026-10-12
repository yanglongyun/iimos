import { connect } from "./browser.js";

export function createControl({ assignments, save, address, stopped, log }) {
  const runs = new Map();
  const locks = new Map();
  function allowedURL(value) {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        url.origin !== new URL(address()).origin &&
        !(
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          url.port === new URL(address()).port
        ) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }
  async function cancel(runId) {
    const run = runs.get(runId);
    if (!run) {
      return;
    }
    run.controller.abort(new Error("浏览器操作已停止"));
    // 等正在 attach 的连接结束并清理，下一轮不能撞上旧的调试连接。
    await run.queue;
    for (const [id, connection] of run.pages) {
      await connection.close();
      locks.delete(id);
    }
    runs.delete(runId);
  }
  async function stopAll(reason) {
    stopped(reason);
    await Promise.all([...runs.keys()].map(cancel));
  }
  async function tab(id, sessionId) {
    if (typeof id !== "string" || !/^\d+$/.test(id) || assignments[id] !== sessionId) {
      throw new Error("标签页未共享给本对话，请在扩展里共享当前页");
    }
    const result = await chrome.tabs.get(Number(id));
    if (!allowedURL(result.url)) {
      throw new Error("不能控制此网页，只允许普通 HTTP/HTTPS 网页");
    }
    return result;
  }
  async function perform(message, run) {
    const { method, args, sessionId } = message;
    run.controller.signal.throwIfAborted();
    if (method === "tabs") {
      const tabs = await chrome.tabs.query({});
      return tabs
        .filter((entry) => assignments[entry.id] === sessionId && allowedURL(entry.url))
        .map((entry) => ({
          id: String(entry.id),
          title: entry.title,
          url: entry.url,
          active: entry.active,
        }));
    }
    if (method === "open" || method === "goto") {
      if (!allowedURL(args.url)) {
        throw new Error("只允许普通网页，不能打开 iimos 本机接口");
      }
    }
    if (method === "open") {
      const created = await chrome.tabs.create({ url: args.url, active: false });
      assignments[created.id] = sessionId;
      await save();
      return { id: String(created.id) };
    }
    const target = await tab(args.id, sessionId);
    run.controller.signal.throwIfAborted();
    if (method === "goto") {
      await chrome.tabs.update(target.id, { url: args.url });
      return { ok: true };
    }
    if (method === "focus") {
      await chrome.tabs.update(target.id, { active: true });
      await chrome.windows.update(target.windowId, { focused: true });
      return { ok: true };
    }
    if (method === "close") {
      const connection = run.pages.get(args.id);
      if (connection) {
        await connection.close();
        run.pages.delete(args.id);
        locks.delete(args.id);
      }
      delete assignments[args.id];
      await chrome.tabs.remove(target.id);
      await save();
      return { ok: true };
    }
    let connection = run.pages.get(args.id);
    if (!connection) {
      if (locks.has(args.id) && locks.get(args.id) !== message.runId) {
        throw new Error("标签页正在执行另一项操作");
      }
      locks.set(args.id, message.runId);
      try {
        connection = await connect(
          target.id,
          run.controller.signal,
          (reason) => {
            void stopAll(reason);
          },
          allowedURL,
        );
        run.pages.set(args.id, connection);
      } catch (error) {
        locks.delete(args.id);
        throw error;
      }
    }
    return connection.perform(method, args);
  }
  function execute(message) {
    if (
      typeof message.runId !== "string" ||
      typeof message.sessionId !== "string" ||
      !message.sessionId ||
      !message.args ||
      typeof message.args !== "object"
    ) {
      return Promise.reject(new Error("浏览器请求格式无效"));
    }
    let run = runs.get(message.runId);
    if (!run) {
      run = {
        sessionId: message.sessionId,
        controller: new AbortController(),
        pages: new Map(),
        queue: Promise.resolve(),
      };
      runs.set(message.runId, run);
    }
    if (run.sessionId !== message.sessionId) {
      return Promise.reject(new Error("运行不能切换对话"));
    }
    log("request", `${message.method} · ${message.sessionId}`, {
      method: message.method,
      args: message.args,
    });
    const result = run.queue.then(() => perform(message, run));
    run.queue = result.catch(() => {});
    return result;
  }
  return { execute, cancel, stopAll, allowedURL };
}
