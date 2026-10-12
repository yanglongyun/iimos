import { createControl } from "./control.js";

const ports = new Set();
const assignments = {};
let connection = { address: "http://127.0.0.1:47231", token: "", enabled: false };
let socket;
let pendingConnect;
let reconnect;
let cleanup = Promise.resolve();
const state = {
  status: "disconnected",
  address: connection.address,
  sessions: [],
  assignments,
  logs: [],
  error: "",
};
function publish() {
  for (const port of ports) {
    try {
      port.postMessage({ type: "state", state });
    } catch {
      ports.delete(port);
    }
  }
}
function log(type, title, detail) {
  // 不记录凭据、截图 Base64 或完整页面正文。
  const data = detail === undefined ? "" : JSON.stringify(detail).slice(0, 3000);
  state.logs.push({ time: Date.now(), type, title, data });
  if (state.logs.length > 200) {
    state.logs.shift();
  }
  publish();
}
const control = createControl({
  assignments,
  address: () => connection.address,
  save: async () => {
    await chrome.storage.session.set({ assignments });
    publish();
  },
  stopped(reason) {
    log("stopped", reason);
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stopped", error: reason }));
    }
  },
  log,
});
const ready = initialize();
async function initialize() {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const saved = await chrome.storage.local.get("connection");
  if (saved.connection) {
    connection = saved.connection;
  }
  Object.assign(assignments, (await chrome.storage.session.get("assignments")).assignments);
  state.address = connection.address;
  await chrome.alarms.create("iimos-reconnect", { periodInMinutes: 0.5 });
  if (connection.enabled && connection.token) {
    open();
  }
}
function address(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("请填写本机地址，例如 http://127.0.0.1:47231");
  }
  return url.origin;
}
function open(code) {
  clearTimeout(reconnect);
  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) {
    return;
  }
  state.status = "connecting";
  state.error = "";
  publish();
  const current = new WebSocket(
    connection.address.replace("http:", "ws:") + "/api/browser/extension",
  );
  socket = current;
  const timer = setTimeout(() => current.close(), 10000);
  current.onopen = () => {
    current.send(
      JSON.stringify(
        code ? { type: "pair", code } : { type: "authenticate", token: connection.token },
      ),
    );
  };
  current.onmessage = (event) => {
    if (socket !== current) {
      return;
    }
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      current.close();
      return;
    }
    if (message.type === "ping") {
      current.send(JSON.stringify({ type: "pong" }));
    } else if (message.type === "connected") {
      clearTimeout(timer);
      void connected(message).catch((error) => {
        state.error = error.message;
        current.close();
      });
    } else if (message.type === "sessions") {
      state.sessions = message.sessions;
      publish();
    } else if (message.type === "request") {
      void execute(current, message);
    } else if (message.type === "cancel") {
      cleanup = cleanup.then(() => control.cancel(message.runId));
    } else if (message.type === "error") {
      state.error = message.error;
      connection.enabled = false;
      void chrome.storage.local.set({ connection });
      pendingConnect?.reject(new Error(message.error));
      pendingConnect = undefined;
      log("error", message.error);
    }
  };
  current.onclose = (event) => {
    clearTimeout(timer);
    if (socket !== current) {
      return;
    }
    socket = undefined;
    state.status = "disconnected";
    state.sessions = [];
    pendingConnect?.reject(new Error(state.error || "无法连接 iimos，请确认客户端已启动"));
    pendingConnect = undefined;
    cleanup = control.stopAll("与 iimos 的连接已断开，正在执行的操作已停止");
    if (event.code === 1008) {
      connection.enabled = false;
      void chrome.storage.local.set({ connection });
    }
    publish();
    if (connection.enabled && connection.token) {
      reconnect = setTimeout(open, 3000);
    }
  };
  current.onerror = () => {};
}
async function connected(message) {
  if (message.token) {
    connection.token = message.token;
  }
  connection.enabled = true;
  await chrome.storage.local.set({ connection });
  state.status = "connected";
  state.error = "";
  pendingConnect?.resolve({ ok: true });
  pendingConnect = undefined;
  log("connected", "已连接 iimos；模型和任务在客户端运行");
}
async function execute(current, message) {
  try {
    await cleanup;
    if (socket !== current || current.readyState !== WebSocket.OPEN) {
      return;
    }
    const result = await control.execute(message);
    if (socket === current && current.readyState === WebSocket.OPEN) {
      current.send(
        JSON.stringify({ type: "result", id: message.id, runId: message.runId, result }),
      );
      log("result", `${message.method} 完成`, result?.png ? { screenshot: true } : { ok: true });
    }
  } catch (error) {
    if (socket === current && current.readyState === WebSocket.OPEN) {
      current.send(
        JSON.stringify({
          type: "result",
          id: message.id,
          runId: message.runId,
          error: error.message,
        }),
      );
    }
    log("error", error.message);
  }
}
async function disconnect() {
  connection.enabled = false;
  clearTimeout(reconnect);
  await chrome.storage.local.set({ connection });
  await control.stopAll("你已停止并断开浏览器控制");
  socket?.close();
  state.status = "disconnected";
  publish();
}
async function handle(message) {
  await ready;
  if (message.type === "connect") {
    if (socket) {
      throw new Error("请先断开当前连接");
    }
    const origin = address(message.address);
    const code = message.code.trim();
    if (!code && (!connection.token || origin !== connection.address)) {
      throw new Error("请在 iimos 设置中生成配对码");
    }
    connection.address = origin;
    state.address = origin;
    return new Promise((resolve, reject) => {
      pendingConnect = { resolve, reject };
      open(code);
    });
  }
  if (message.type === "disconnect") {
    await disconnect();
  } else if (message.type === "stop") {
    await control.stopAll("你已在扩展里停止本轮控制");
  } else if (message.type === "sessions") {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "sessions" }));
    }
  } else if (message.type === "share") {
    if (
      state.status !== "connected" ||
      !state.sessions.some((session) => session.id === message.sessionId)
    ) {
      throw new Error("请先连接并选择 iimos 中的一个对话");
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !control.allowedURL(tab.url)) {
      throw new Error("请切到需要共享的普通网页");
    }
    await control.stopAll("网页共享范围已调整，本轮控制已停止");
    assignments[tab.id] = message.sessionId;
    await chrome.storage.session.set({ assignments });
    log("shared", `已共享 · ${tab.title}`, { tabId: tab.id, sessionId: message.sessionId });
  } else if (message.type === "unshare") {
    await control.stopAll("网页共享已取消，本轮控制已停止");
    delete assignments[message.tabId];
    await chrome.storage.session.set({ assignments });
    publish();
  } else if (message.type === "clear") {
    state.logs = [];
    publish();
  } else if (message.type === "open-client") {
    await chrome.tabs.create({ url: connection.address });
  }
  return { ok: true };
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel" || port.sender?.url !== chrome.runtime.getURL("panel.html")) {
    port.disconnect();
    return;
  }
  ports.add(port);
  void ready.then(publish);
  port.onDisconnect.addListener(() => ports.delete(port));
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.url !== chrome.runtime.getURL("panel.html")) {
    return;
  }
  handle(message).then(reply, (error) => reply({ error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (assignments[tabId]) {
    delete assignments[tabId];
    void control.stopAll("共享的网页已关闭，本轮控制已停止");
    void chrome.storage.session.set({ assignments });
    publish();
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "iimos-reconnect") {
    void ready.then(() => {
      if (connection.enabled && connection.token && !socket) {
        open();
      }
    });
  }
});
