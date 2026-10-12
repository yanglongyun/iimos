const element = (id) => document.getElementById(id);
let state;
function notice(message) {
  element("notice").textContent = message;
  element("notice").hidden = !message;
}
async function send(message) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (result?.error) {
      throw new Error(result.error);
    }
    notice("");
    return result;
  } catch (error) {
    notice(error.message);
  }
}
function render(next) {
  state = next;
  const connected = state.status === "connected";
  element("status").textContent = {
    connected: "已连接",
    connecting: "连接中",
    disconnected: "未连接",
  }[state.status];
  element("status").dataset.status = connected ? "completed" : "idle";
  element("disconnect").hidden = state.status === "disconnected";
  element("connect").disabled = state.status !== "disconnected";
  element("share").disabled = !connected;
  element("stop").disabled = !connected;
  if (document.activeElement !== element("address")) {
    element("address").value = state.address;
  }
  if (connected) {
    element("code").value = "";
  }
  const selected = element("session").value;
  element("session").replaceChildren(new Option("共享给 iimos", ""));
  for (const session of state.sessions) {
    element("session").add(new Option(session.title || "新对话", session.id));
  }
  element("session").value = selected;
  element("shared").replaceChildren();
  for (const [tabId, sessionId] of Object.entries(state.assignments)) {
    const row = document.createElement("div");
    row.className = "shared-row";
    const text = document.createElement("span");
    text.textContent = `网页 ${tabId} → ${state.sessions.find((session) => session.id === sessionId)?.title || "对话"}`;
    void chrome.tabs
      .get(Number(tabId))
      .then((tab) => {
        text.textContent = `${tab.title || "网页"} → ${state.sessions.find((session) => session.id === sessionId)?.title || "对话"}`;
        row.title = tab.url || "";
      })
      .catch(() => {});
    const button = document.createElement("button");
    button.className = "text-button";
    button.textContent = "取消共享";
    button.onclick = () => {
      void send({ type: "unshare", tabId });
    };
    row.append(text, button);
    element("shared").append(row);
  }
  element("empty").hidden = state.logs.length > 0;
  element("logs").replaceChildren();
  for (const entry of [...state.logs].reverse()) {
    const detail = document.createElement("details");
    detail.className = "log-entry";
    const summary = document.createElement("summary");
    summary.textContent = `${new Date(entry.time).toLocaleTimeString()} · ${entry.title}`;
    const data = document.createElement("pre");
    data.textContent = entry.data;
    detail.append(summary, data);
    element("logs").append(detail);
  }
  if (state.error) {
    notice(state.error);
  }
}
function connectPanel() {
  const port = chrome.runtime.connect({ name: "panel" });
  port.onMessage.addListener((message) => {
    if (message.type === "state") {
      render(message.state);
    }
  });
  port.onDisconnect.addListener(() => {
    setTimeout(connectPanel, 1000);
  });
}
connectPanel();
element("connection-form").onsubmit = (event) => {
  event.preventDefault();
  void send({ type: "connect", address: element("address").value, code: element("code").value });
};
for (const id of ["disconnect", "stop", "clear", "open-client"]) {
  element(id).onclick = () => {
    void send({ type: id });
  };
}
element("refresh").onclick = () => {
  void send({ type: "sessions" });
};
element("share").onclick = () => {
  void send({ type: "share", sessionId: element("session").value });
};
element("export").onclick = () => {
  const blob = new Blob([JSON.stringify(state?.logs || [], null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "iimos-browser-log.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
