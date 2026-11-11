import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaults, paths, loadConfig, validateConfig } from "../config.js";

test("配置文件不存在时写一份默认的；字段类型错了直接报错，不改文件", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-config-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const locations = paths({ IIMOS_DATA: root });
  assert.deepEqual(loadConfig(locations), defaults());
  const raw = JSON.stringify({ ...defaults(), keep: "many" });
  await fs.writeFile(locations.config, raw);
  assert.throws(() => loadConfig(locations), /keep/);
  assert.equal(await fs.readFile(locations.config, "utf8"), raw);
});
test("配置拒绝无效 URL、窗口阈值和未知字段", () => {
  const config = defaults();
  validateConfig(config);
  assert.throws(() => validateConfig({ ...config, responsesUrl: "file:///tmp/model" }), /HTTP/);
  assert.throws(
    () => validateConfig({ ...config, context_window: 100, compact_at: 100 }),
    /压缩阈值/,
  );
  assert.throws(
    () => validateConfig({ ...config, context_window: 100, compact_at: 101 }),
    /压缩阈值/,
  );
  validateConfig({ ...config, context_window: 100, compact_at: 99 });
  // config.json 是所有形态共用的：别的形态的字段原样保留，不报错。
  validateConfig({ ...config, contextWindow: 128000 });
});

test("别的形态留下的 config.json：缺的字段补默认值并写回，多的字段原样保留", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-config-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const locations = paths({ IIMOS_DATA: root });
  await fs.writeFile(
    locations.config,
    JSON.stringify({
      responsesUrl: "https://x.test/v1/responses",
      apiKey: "k",
      model: "m",
      contextWindow: 128000,
    }),
  );
  const config = loadConfig(locations);
  assert.equal(config.model, "m");
  assert.equal(config.contextWindow, 128000);
  assert.equal(config.keep, defaults().keep);
  const saved = JSON.parse(await fs.readFile(locations.config, "utf8"));
  assert.equal(saved.contextWindow, 128000);
  assert.equal(saved.compact_at, defaults().compact_at);
});
