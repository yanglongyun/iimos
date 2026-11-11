// 形态的入口，由 launcher 加载。起本地服务 → 报到 iimos.ready({ url })。
//
// 纯 Node，不碰 Electron：launcher 开窗口加载这个地址。窗口、通知、浏览器这些系统的事通过 globalThis.iimos 叫 launcher 做。
// 不经 launcher 也能跑（node main.js）：那时没有快照和回滚，数据放 IIMOS_DATA 或 AGENT_HOME，地址打在终端里，浏览器工具不可用。
import { randomBytes } from "node:crypto";
import { createServer } from "./server/index.js";
import { paths, loadConfig } from "./server/config.js";

const iimos = globalThis.iimos;
const token = randomBytes(32).toString("hex");

// 浏览器插件归 launcher 管；形态只是把工具的命令转过去。
let browser = null;
if (iimos) {
  let connected = false;
  iimos.on("browser.connected", () => {
    connected = true;
  });
  iimos.on("browser.disconnected", () => {
    connected = false;
  });
  iimos
    .call("browser.status")
    .then((status) => {
      connected = status.connected;
    })
    .catch(() => {});
  browser = {
    request(action, args, signal) {
      signal?.throwIfAborted();
      return iimos.call("browser.request", { action, args });
    },
    connected: () => connected,
  };
}

const p = paths();
const runtime = createServer({ p, config: loadConfig(p), token, browser });
const origin = await runtime.listen(Number(process.env.PORT) || 0);
const url = `${origin}/?token=${token}`;

if (iimos) {
  iimos.onShutdown(() => runtime.close());
  iimos.ready({
    url,
    window: {
      width: 1440,
      height: 900,
      minWidth: 1100,
      minHeight: 680,
      title: "agentic",
      background: "#ffffff",
      // 用系统原生标题栏:红绿灯和窗口钮归系统,界面不用给它们让位
      titleBar: "native",
    },
  });
} else {
  console.log(url);
}
