import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { checkStyle } from "./check-style.js";

checkStyle("../server");
checkStyle("src");
checkStyle("tests");

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-ui-tests-"));
try {
  const output = path.join(directory, "behavior.test.mjs");
  await build({
    entryPoints: ["tests/behavior.test.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
  });
  const result = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
