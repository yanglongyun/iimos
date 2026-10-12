// 通过当前标签页的 CDP 连接操作页面，不移动系统鼠标。
const keys = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Space: 32,
};
function installActivity() {
  window.__iimosExtensionControl?.dispose();
  const state = { input: false };
  function activity(event) {
    if (event.isTrusted && !state.input) {
      window.iimosUserActivity("manual-input");
    }
  }
  function dispose() {
    for (const type of ["pointerdown", "keydown", "wheel"]) {
      window.removeEventListener(type, activity, true);
    }
    delete window.__iimosExtensionControl;
  }
  window.__iimosExtensionControl = { state, dispose };
  for (const type of ["pointerdown", "keydown", "wheel"]) {
    window.addEventListener(type, activity, true);
  }
}
export async function connect(tabId, signal, takeover, allowedURL) {
  const target = { tabId };
  const platform = await chrome.runtime.getPlatformInfo();
  let contextId;
  let attached = false;
  let closing;
  async function command(method, params = {}) {
    signal.throwIfAborted();
    return chrome.debugger.sendCommand(target, method, params);
  }
  function event(source, method, params) {
    if (source.tabId !== tabId || closing) {
      return;
    }
    if (method === "Page.frameNavigated" && !params.frame.parentId) {
      contextId = undefined;
      if (!allowedURL(params.frame.url)) {
        takeover("目标网页进入受保护地址，已停止控制");
      }
    }
    if (
      method === "Runtime.bindingCalled" &&
      params.name === "iimosUserActivity" &&
      params.executionContextId === contextId
    ) {
      takeover("检测到你手动操作目标网页，已停止控制");
    }
  }
  function detached(source) {
    if (source.tabId === tabId && !closing) {
      attached = false;
      takeover("调试连接断开，已停止控制");
    }
  }
  async function evaluate(expression) {
    const deadline = Date.now() + 15000;
    while ((await chrome.tabs.get(tabId)).status === "loading") {
      signal.throwIfAborted();
      if (Date.now() > deadline) {
        throw new Error("页面尚未就绪，请检查后重试");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!allowedURL((await chrome.tabs.get(tabId)).url)) {
      throw new Error("不能操作受保护地址");
    }
    if (!contextId) {
      const tree = await command("Page.getFrameTree");
      const world = await command("Page.createIsolatedWorld", {
        frameId: tree.frameTree.frame.id,
        worldName: "iimos-extension",
      });
      contextId = world.executionContextId;
      await command("Runtime.evaluate", {
        expression: `(${installActivity.toString()})()`,
        contextId,
      });
    }
    const result = await command("Runtime.evaluate", {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
      timeout: 5000,
    });
    signal.throwIfAborted();
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    }
    return result.result.value;
  }
  async function click(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw new Error("点击需要非负视口坐标");
    }
    const point = { x, y, button: "left", clickCount: 1 };
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
    });
  }
  async function perform(method, args) {
    if (method === "evaluate") {
      return evaluate(args.expression);
    }
    if (method === "screenshot") {
      const size = await evaluate("({width: innerWidth, height: innerHeight, url: location.href})");
      const { data } = await command("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      return { png: data, ...size };
    }
    await evaluate("window.__iimosExtensionControl.state.input = true");
    try {
      if (method === "click") {
        await click(args.x, args.y);
      } else if (method === "type") {
        if (typeof args.text !== "string") {
          throw new Error("type 需要字符串");
        }
        await command("Input.insertText", { text: args.text });
      } else if (method === "press") {
        if (!Object.hasOwn(keys, args.key)) {
          throw new Error("不支持此按键，文字请用 type");
        }
        const input = {
          key: args.key === "Space" ? " " : args.key,
          code: args.key,
          windowsVirtualKeyCode: keys[args.key],
        };
        await command("Input.dispatchKeyEvent", { type: "keyDown", ...input });
        await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
          type: "keyUp",
          ...input,
        });
      } else if (method === "act") {
        if (!["click", "fill", "select", "scroll"].includes(args.kind)) {
          throw new Error("无效 Jev 操作");
        }
        const point = await evaluate(args.expression);
        if (point.stale) {
          return point;
        }
        if (args.kind === "scroll") {
          await command("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: point.x,
            y: point.y,
            deltaX: 0,
            deltaY: args.delta,
          });
        } else if (args.kind !== "select") {
          await click(point.x, point.y);
          if (args.kind === "fill") {
            if (typeof args.text !== "string") {
              throw new Error("填写内容必须是字符串");
            }
            const input = {
              key: "a",
              code: "KeyA",
              commands: ["selectAll"],
              modifiers: platform.os === "mac" ? 4 : 2,
            };
            await command("Input.dispatchKeyEvent", { type: "keyDown", ...input });
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "keyUp",
              ...input,
            });
            await command("Input.insertText", { text: args.text });
          }
        }
      } else {
        throw new Error(`未知操作：${method}`);
      }
      return { ok: true };
    } finally {
      if (contextId && attached) {
        await chrome.debugger
          .sendCommand(target, "Runtime.evaluate", {
            expression:
              "if (window.__iimosExtensionControl) { window.__iimosExtensionControl.state.input = false; }",
            contextId,
          })
          .catch(() => {});
      }
    }
  }
  function close() {
    if (closing) {
      return closing;
    }
    closing = dispose();
    return closing;
  }
  async function dispose() {
    chrome.debugger.onEvent.removeListener(event);
    chrome.debugger.onDetach.removeListener(detached);
    signal.removeEventListener("abort", abort);
    if (attached) {
      if (contextId) {
        await chrome.debugger
          .sendCommand(target, "Runtime.evaluate", {
            expression: "window.__iimosExtensionControl?.dispose()",
            contextId,
          })
          .catch(() => {});
      }
      await chrome.debugger.detach(target).catch(() => {});
      attached = false;
    }
  }
  function abort() {
    if (attached) {
      void chrome.debugger.sendCommand(target, "Runtime.terminateExecution").catch(() => {});
    }
    void close();
  }
  try {
    chrome.debugger.onEvent.addListener(event);
    chrome.debugger.onDetach.addListener(detached);
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    signal.addEventListener("abort", abort, { once: true });
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Runtime.addBinding", {
      name: "iimosUserActivity",
      executionContextName: "iimos-extension",
    });
    await evaluate("true");
    return { perform, close };
  } catch (error) {
    await close();
    throw error;
  }
}
