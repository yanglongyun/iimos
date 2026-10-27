import events from "./events/index.js";
import authorize from "./authorize.js";
import sessions from "./sessions/index.js";
import config from "./config/index.js";
import status from "./status/index.js";
import images from "./images/index.js";
import { fail } from "./http.js";

export default function createApi(context) {
  // 正在运行的回复：会话 ID → { controller, done, text, reasoning }。text 和 reasoning 是还没形成完整 item 的流式文字。
  context.runs = new Map();
  // 事件通道的全部连接。
  context.streams = new Set();

  async function route(req, res, parts) {
    const name = parts[0];
    const rest = parts.slice(1);
    authorize(req, context);

    switch (name) {
      case "events":
        return events(req, res, rest, context);
      case "sessions":
        return sessions(req, res, rest, context);
      case "config":
        return config(req, res, rest, context);
      case "status":
        return status(req, res, rest, context);
      case "images":
        return images(req, res, rest, context);
      default:
        fail(404, "接口不存在");
    }
  }

  async function close() {
    for (const res of context.streams) {
      res.end();
    }
    context.streams.clear();
    const runs = [...context.runs.values()];
    for (const run of runs) {
      run.controller.abort();
    }
    await Promise.all(runs.map((run) => run.done));
  }

  return { route, close };
}
