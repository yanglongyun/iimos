# iimos 98

Windows 98 经典桌面形态。唯一源码是仓库中的 `shapes/development/win98/`，运行时由 launcher 播种到用户的 workspace。

## 结构

- `main.js`：纯 Node 入口，启动本机服务并向 launcher 报到，使用系统原生外框。
- `server/index.js`：令牌保护的 127.0.0.1 服务、对话接口、SSE 和桌面文件接口。
- `server/conversation.js`：一个持久化对话、上下文压缩、停止与重启接续。
- `server/agent/`：Responses 模型与 shell 工具循环，基础提示词是 `prompt.md`。
- `server/desktop.js`：应用源码和我的文档两处文件浏览、文本预览、带版本检查的便笺保存。
- `ui/src/windowing.ts`：窗口状态、焦点、层级和拖动缩放边界，唯一的窗口状态模型。
- `ui/src/App.tsx`：桌面图标、开始菜单、任务栏、时钟和应用窗口。
- `ui/src/components/Window.tsx`：窗口外框、八向缩放、拖动、最大化、还原和关闭。
- `ui/src/components/Chat.tsx`：对话历史、流式回复、工具调用与发送框。
- `ui/src/components/Explorer.tsx`：文件夹、列表/图标视图、面包屑式位置和文本预览。
- `ui/src/components/Notepad.tsx`：便笺编辑，700ms 自动保存，Ctrl/Cmd+S 立即保存；窗口关闭后组件保留，未保存内容不会丢弃。
- `ui/src/components/Settings.tsx`：模型属性；未配置模型时可以继续使用其他桌面工具。
- `ui/src/components/Icon.tsx`：32×32 整数像素的 SVG 图标，随源码维护，不加载网络图标。
- `ui/src/style.css`：Windows 98 经典配色与立体边框。
- `ui/dist/`：编译产物，必须随源码进入版本库。

## 数据与接口

配置固定在 `$IIMOS_DATA/config.json`，只修改本形态使用的字段，保留其他字段。
对话在 `$IIMOS_DATA/win98/conversation.json`，文档目录是 `$IIMOS_DATA/win98/documents/`，便笺是其中的 `note.txt`。
不导入或修改其他形态的对话。单独启动时可指定 `IIMOS_DATA`，否则使用形态目录的 `.data/`。

`GET /api/files?volume=workspace|documents&path=` 列目录；`GET /api/file` 使用同样参数预览 UTF-8 文本。
文件位置必须留在对应根目录内，包括解析符号链接后的真实路径。只读预览上限为 512KB。
`GET /api/note` 返回 `{ text, version }`；`POST /api/note` 提交同样结构，版本过期返回 409，禁止覆盖别处的新内容。
所有 API 都校验 launcher 界面地址中的本机令牌。

## 窗口与交互

每个应用只有一个窗口。窗口关闭、最小化、最大化、位置和尺寸由 `windowing.ts` 的状态描述；内容组件不会因窗口隐藏而卸载。
任务栏顺序使用打开时的窗口列表，层级由独立的 `order` 决定；切换焦点不能改变任务栏位置。
双击桌面图标打开应用；任务栏按钮切换/最小化；显示桌面隐藏所有窗口，助手快速启动按钮可随时恢复对话。
Ctrl+Esc 打开开始菜单，方向键导航，Esc 关闭。Alt+F4 关闭当前窗口。对话 Enter 发送、Shift+Enter 换行、Esc 停止。

## 开发验证

先在 `client/` 安装依赖，本形态直接复用 launcher 的工具链，不维护重复依赖。

```sh
npm run build
npm run check
npm test
```

通过 launcher 运行：在 `client/` 中执行 `IIMOS_SEED=../shapes/development/win98 IIMOS_HOME=/tmp/iimos-win98 npm run app`。
改界面用 `iimos reload`，改服务用 `iimos restart`，完成后同步本说明。不要加入兼容和迁移逻辑。
