import fs from "node:fs";
import path from "node:path";
import { renderPrompt } from "./config.js";

const read = (file, limit = 40000) => {
  try {
    return fs.readFileSync(file, "utf8").slice(0, limit);
  } catch {
    return "";
  }
};

// 主模型的指令：设置里的提示词 + launcher 契约 + AGENT.md + 回滚通知。每一轮现读，契约和 AGENT.md 都可能刚被改过。
export function buildInstructions(config, workspace) {
  const parts = [renderPrompt(config.system, config.workdir)];
  const contract = read(process.env.IIMOS_CONTRACT || "");
  if (contract) {
    parts.push(contract);
  }
  const agentDoc = read(path.join(workspace, "AGENT.md"));
  if (agentDoc) {
    parts.push(`# 当前的 AGENT.md\n\n${agentDoc}`);
  }
  const rollback = read(path.join(workspace, ".iimos", "rollback.json"));
  if (rollback) {
    parts.push(
      `# 注意：应用被 launcher 回滚过\n\n${rollback}\n先告诉用户发生了什么。处理完后删掉 .iimos/rollback.json。`,
    );
  }
  return parts.join("\n\n---\n\n");
}
