// 桌面只浏览两个明确的目录；「我的文档」里有便笺 note.txt 和待办事项 todos.json。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const error = (status, message) =>
  Object.assign(new Error(message), { status });
const NOTE_LIMIT = 512 * 1024;
const TODO_COUNT = 500;
const TODO_TEXT = 200;
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");

export function desktopFiles(workspace, data) {
  const documents = path.join(data, "win98", "documents");
  fs.mkdirSync(documents, { recursive: true });
  const roots = {
    workspace: fs.realpathSync(workspace),
    documents: fs.realpathSync(documents),
  };
  const noteFile = path.join(documents, "note.txt");
  const todoFile = path.join(documents, "todos.json");

  function location(volume, relative) {
    const root = roots[volume];
    if (!root || typeof relative !== "string" || relative.includes("\0"))
      throw error(400, "文件位置无效");
    const candidate = path.resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(root + path.sep))
      throw error(403, "无法访问此目录");
    let target;
    try {
      target = fs.realpathSync(candidate);
    } catch {
      throw error(404, "文件或目录不存在");
    }
    if (target !== root && !target.startsWith(root + path.sep))
      throw error(403, "无法访问此目录");
    return { root, target };
  }

  async function list(volume, relative) {
    const { target } = location(volume, relative);
    if (!fs.statSync(target).isDirectory())
      throw error(400, "请选择一个文件夹");
    const entries = await fs.promises.readdir(target, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter(
          (entry) =>
            ![".git", ".iimos", ".data", "node_modules", ".DS_Store"].includes(
              entry.name,
            ),
        )
        .map(async (entry) => {
          const stat = await fs.promises.lstat(path.join(target, entry.name));
          return {
            name: entry.name,
            directory: entry.isDirectory(),
            link: entry.isSymbolicLink(),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        }),
    );
    files.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name, "zh-CN"),
    );
    return { path: relative, location: target, entries: files };
  }

  function read(volume, relative) {
    const { target } = location(volume, relative);
    const stat = fs.statSync(target);
    if (!stat.isFile()) throw error(400, "请选择一个文件");
    if (stat.size > NOTE_LIMIT) throw error(413, "文件超过 512 KB，无法预览");
    const buffer = fs.readFileSync(target);
    if (buffer.includes(0)) throw error(415, "此文件不支持文本预览");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw error(415, "此文件不支持文本预览");
    }
    return { name: path.basename(target), text };
  }

  function note() {
    const text = fs.existsSync(noteFile)
      ? fs.readFileSync(noteFile, "utf8")
      : "";
    return { text, version: hash(text) };
  }

  function saveNote({ text, version }) {
    if (typeof text !== "string" || typeof version !== "string")
      throw error(400, "便笺内容无效");
    if (Buffer.byteLength(text) > NOTE_LIMIT)
      throw error(413, "便笺不能超过 512 KB");
    if (version !== note().version)
      throw error(409, "便笺已在其他窗口修改。请复制当前内容后重新打开。");
    fs.writeFileSync(`${noteFile}.tmp`, text, { mode: 0o600 });
    fs.renameSync(`${noteFile}.tmp`, noteFile);
    return note();
  }

  /** 待办事项：我的文档里的一份 JSON，版本就是文件内容的哈希，和便笺同一套冲突检查。 */
  function todos() {
    if (!fs.existsSync(todoFile)) return { items: [], version: hash("") };
    const text = fs.readFileSync(todoFile, "utf8");
    let items;
    try {
      items = JSON.parse(text).items;
    } catch {
      throw error(500, "我的文档中的 todos.json 已损坏，请备份后删除该文件");
    }
    if (!Array.isArray(items))
      throw error(500, "我的文档中的 todos.json 已损坏，请备份后删除该文件");
    return { items, version: hash(text) };
  }

  function saveTodos({ items, version }) {
    if (!Array.isArray(items) || typeof version !== "string")
      throw error(400, "待办内容无效");
    if (items.length > TODO_COUNT)
      throw error(413, `待办最多 ${TODO_COUNT} 项`);
    const ids = new Set();
    const clean = items.map((item) => {
      const id = typeof item?.id === "string" ? item.id : "";
      const text = typeof item?.text === "string" ? item.text.trim() : "";
      if (!id || ids.has(id)) throw error(400, "待办标识无效");
      if (!text || text.length > TODO_TEXT)
        throw error(400, `每条待办需要 1 到 ${TODO_TEXT} 个字符`);
      ids.add(id);
      return { id, text, done: item.done === true };
    });
    if (version !== todos().version)
      throw error(409, "待办已在其他窗口修改。请重新打开待办事项。");
    fs.writeFileSync(`${todoFile}.tmp`, `${JSON.stringify({ items: clean }, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(`${todoFile}.tmp`, todoFile);
    return todos();
  }

  return { list, read, note, saveNote, todos, saveTodos };
}
