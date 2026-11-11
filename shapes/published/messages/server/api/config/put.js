import { saveConfig, validateConfig } from "../../config.js";
import { body, json, fail } from "../http.js";

export default async function put(req, res, context) {
  const patch = await body(
    req,
    [
      "responsesUrl",
      "apiKey",
      "model",
      "context_window",
      "system",
      "compact_at",
      "keep",
      "compact_system",
      "compact_prefix",
      "workdir",
      "run_timeout",
      "timeout",
      "max_output",
    ],
    512 * 1024,
  );
  const next = {
    ...context.config,
  };

  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case "responsesUrl":
      case "apiKey":
      case "model":
      case "workdir": {
        if (typeof value !== "string") {
          fail(400, `${key} 必须是字符串`);
        }
        // 设置页不回显密钥，留空表示保留已保存的密钥。
        if (key === "apiKey" && value.trim() === "") {
          break;
        }
        next[key] = value.trim();
        break;
      }
      case "system":
      case "compact_system":
      case "compact_prefix":
      case "context_window":
      case "compact_at":
      case "keep":
      case "run_timeout":
      case "timeout":
      case "max_output": {
        next[key] = value;
        break;
      }
    }
  }

  try {
    validateConfig(next);
  } catch (error) {
    fail(400, error.message);
  }

  saveConfig(context.paths, next);
  context.config = next;
  return json(res, 200, { saved: true });
}
