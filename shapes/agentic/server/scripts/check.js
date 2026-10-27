import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "../config.js";
function check(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      check(filename);
    } else if (entry.name.endsWith(".js")) {
      const result = spawnSync(process.execPath, ["--check", filename], {
        stdio: "inherit",
      });
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        process.exit(result.status || 1);
      }
    }
  }
}
check(path.join(ROOT, "server"));
console.log("JavaScript 语法检查通过");
