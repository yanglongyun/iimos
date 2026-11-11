import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveImage } from "../images.js";
import prepareImages from "../ai/images.js";

test("图片转换只影响请求，保留原块和远程地址；本地文件缺失或越界时终止", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-images-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const url = await saveImage(directory, Buffer.from("image bytes"), ".png");
  const messages = [
    { type: "reasoning", id: "r1", encrypted_content: "opaque", summary: [] },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_image", image_url: url, detail: "high" }],
    },
    {
      type: "function_call_output",
      call_id: "c1",
      output: [
        { type: "input_text", text: "图片" },
        { type: "input_image", image_url: url, detail: "auto" },
      ],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_image", image_url: "https://example.com/image.png" }],
    },
  ];
  const before = JSON.stringify(messages);
  const input = await prepareImages(messages, directory);
  assert.equal(JSON.stringify(messages), before);
  assert.equal(input[0], messages[0]);
  assert.equal(input[3], messages[3]);
  assert.equal(input[1].content[0].image_url, "data:image/png;base64,aW1hZ2UgYnl0ZXM=");
  assert.equal(input[1].content[0].detail, "high");
  assert.equal(input[2].output[1].image_url, input[1].content[0].image_url);
  assert.equal(input[2].call_id, "c1");
  await fs.unlink(path.join(directory, path.basename(url)));
  await assert.rejects(prepareImages(messages, directory), { code: "ENOENT" });
  await assert.rejects(
    prepareImages(
      [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "/api/images/../config.json" }],
        },
      ],
      directory,
    ),
    { code: "ENOENT" },
  );
});
