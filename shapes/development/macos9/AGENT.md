# iimos 9

Mac OS 9 Platinum 风格桌面形态。源码只在 `shapes/development/macos9/` 维护，运行时由 launcher 播种到 workspace。

- `main.js`：本地服务入口，向 launcher 报到；外层使用原生标题栏。
- `server/index.js`：127.0.0.1 服务、令牌校验、SSE、对话与桌面文件接口。
- `server/desktop.js`：Finder 的应用源码和文档根目录、文本预览、便笺和待办的版本检查与原子保存。
- `server/conversation.js`、`server/agent/`、`server/ai/`：一个持久化对话、shell 工具、Responses 请求、自动压缩和重启接续。
- `ui/src/windowing.ts`：窗口唯一状态、边界、焦点与层级。tasks 是应用切换列表，order 仅描述窗口层级。
- `ui/src/App.tsx`：顶部全局菜单、右侧桌面图标、应用切换和底部控制条。
- `ui/src/components/Window.tsx`：Platinum 条纹标题栏、左侧关闭、右侧缩放与隐藏、八向缩放。
- `ui/src/components/Chat.tsx`、`Explorer.tsx`、`Notepad.tsx`、`Todo.tsx`、`Settings.tsx`：助手、Finder、便笺、待办和模型配置。

用户数据：`$IIMOS_DATA/macos9/conversation.json`、`documents/note.txt`、`documents/todos.json`。共用模型配置固定在 `$IIMOS_DATA/config.json`。
关闭或隐藏窗口保留编辑组件与草稿；在菜单栏的「窗口」和应用切换器中恢复窗口。Cmd/Ctrl+W 关闭当前窗口，Esc 关闭菜单。

前端依赖由 `client/` 的 launcher 工具链提供；`ui/dist/` 必须随源码维护。开发执行 `npm run build`、`npm run check`、`npm test`。
不添加迁移、旧数据兼容或第二份源码，不修改其他形态的数据。
