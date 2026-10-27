import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// 只检查项目已经明确的简单规则，不引入一套可配置 lint 框架。
export function checkStyle(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "dist"].includes(entry.name)) {
      continue;
    }
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      checkStyle(filename);
      continue;
    }
    if (!/\.[jt]sx?$/.test(entry.name)) {
      continue;
    }
    const source = ts.createSourceFile(
      filename,
      fs.readFileSync(filename, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      let problem = "";
      if (ts.isVariableDeclarationList(node) && node.declarations.length > 1) {
        problem = "每条声明只定义一个变量";
      }
      if (ts.isIfStatement(node)) {
        if (
          !ts.isBlock(node.thenStatement) ||
          (node.elseStatement &&
            !ts.isBlock(node.elseStatement) &&
            !ts.isIfStatement(node.elseStatement))
        ) {
          problem = "if/else 必须使用大括号";
        }
      }
      if (
        (ts.isForStatement(node) ||
          ts.isForOfStatement(node) ||
          ts.isForInStatement(node) ||
          ts.isWhileStatement(node) ||
          ts.isDoStatement(node)) &&
        !ts.isBlock(node.statement)
      ) {
        problem = "循环必须使用大括号";
      }
      if (problem) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        throw new Error(`${filename}:${position.line + 1} ${problem}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
