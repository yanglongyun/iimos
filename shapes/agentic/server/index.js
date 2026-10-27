import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, version, paths, loadConfig, validateConfig } from "./config.js";
import openDB from "./db.js";
import createApi from "./api/index.js";
import { fail, json } from "./api/http.js";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// 没接上 launcher 时的浏览器：工具会得到明确的失败。
const offline = {
  request: () =>
    Promise.reject(new Error("浏览器插件未连接：请在 Chrome 或 Edge 里安装并启用 iimos 插件")),
  connected: () => false,
};

// token 是本次启动的令牌。窗口第一次带着 ?token= 打开，服务端换成 HttpOnly Cookie，之后的接口都认这个 Cookie。
export function createServer({ p = paths(), config = loadConfig(p), token, browser = offline }) {
  validateConfig(config);
  const publicDir = path.join(ROOT, "ui");
  const db = openDB(p.db);
  let api;
  const context = { db, paths: p, config, token, publicDir, version, browser };
  try {
    api = createApi(context);
  } catch (error) {
    db.close();
    throw error;
  }
  const sockets = new Set();
  const server = http.createServer(
    { requestTimeout: 30000, maxHeaderSize: 16384 },
    async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        let parts;
        try {
          parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        } catch {
          fail(400, "URL 无效");
        }
        if (parts[0] === "api") {
          return await api.route(req, res, parts.slice(1));
        }
        if (!["GET", "HEAD"].includes(req.method)) {
          fail(405, "不支持的方法");
        }
        if (parts.some((p) => p.startsWith(".") || /[\/\\\0]/.test(p))) {
          fail(404, "文件不存在");
        }
        // 页面路由返回同一份 UI 入口；资源文件和 API 仍按各自路径处理。
        const pageRoute =
          parts.length === 0 ||
          (parts.length === 1 && parts[0] === "settings") ||
          (parts.length === 2 && parts[0] === "sessions");
        if (pageRoute && url.searchParams.get("token") === token) {
          // 令牌只在地址里出现这一次：写进 Cookie，再跳回不带令牌的地址。
          res.writeHead(302, {
            "set-cookie": `agentic_token=${token}; Path=/; HttpOnly; SameSite=Strict`,
            location: url.pathname,
          });
          return res.end();
        }
        let filename = path.join(publicDir, ...parts);
        if (pageRoute) {
          filename = path.join(publicDir, "index.html");
        }
        let real;
        try {
          real = await fs.realpath(filename);
        } catch {
          fail(404, "文件不存在");
        }
        const relative = path.relative(await fs.realpath(publicDir), real);
        if (
          relative.startsWith("..") ||
          path.isAbsolute(relative) ||
          !(await fs.stat(real)).isFile()
        ) {
          fail(404, "文件不存在");
        }
        const content = await fs.readFile(real);
        res.writeHead(200, {
          "content-type": mime[path.extname(real)] || "application/octet-stream",
          "x-content-type-options": "nosniff",
          "content-length": content.length,
          "cache-control": "no-cache",
        });
        res.end(req.method === "HEAD" ? undefined : content);
      } catch (error) {
        if (res.destroyed) {
          return;
        }
        if (res.headersSent) {
          return res.destroy();
        }
        json(res, error.status || 500, { error: error.message });
      }
    },
  );
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  let closing = null;

  async function shutdown() {
    const closed = new Promise((resolve) => server.close(resolve));
    for (const socket of sockets) {
      socket.destroy();
    }
    await api.close();
    await closed;
    db.close();
  }

  return {
    server,
    db,
    context,
    // 只在本机 127.0.0.1 监听，port 为 0 时由系统分配。
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve(`http://127.0.0.1:${server.address().port}`);
        });
      });
    },
    close() {
      if (!closing) {
        closing = shutdown();
      }
      return closing;
    },
  };
}
