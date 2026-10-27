# agentic

iimos 的一个形态：类 ChatGPT 的本地 Agent。左侧是对话列表，右侧是对话。Agent 有 shell、read、write、edit 四个本机工具，
在你的电脑上执行命令、读写文件；装上 iimos 的浏览器插件后，还能用 browser 工具控制你的 Chrome / Edge。
模型用你自己的（BYOK）：地址、Key、模型名在设置里填，没有云端账号。

形态就是一份源码：换上它之后，这个目录就是 agent 自己的身体，它可以改自己的界面、服务和工具；改坏了 launcher 会退回上一个能用的版本。

## 目录

```text
main.js            入口：起本地服务，向 launcher 报到
server/            本地 API、Agent、模型请求、数据库（node:sqlite）
ui/                界面（React + TypeScript）；src/ 源码，vendor/ 第三方库，dist/ 编译产物
scripts/           在仓库里编译界面
AGENT.md           写给 agent 自己的说明，每轮都在它的指令里
.dev/              设计文档：Agent 原理、聊天层与事件
```

## 用它

在 iimos 里换上这个形态（形态墙上的 agentic），或者开发时直接把这份源码当出厂种子启动：

```bash
cd iimos/client && IIMOS_SEED=../shapes/agentic IIMOS_HOME=/tmp/agentic-dev npm run app
```

不经 launcher 也能跑（没有快照回滚，浏览器工具不可用）：

```bash
npm run ui:build && node main.js
```

## 开发

要求 Node.js 22.5 或更高版本。

```bash
npm run setup       # 装根目录和 ui 的依赖
npm test            # 服务端测试
npm run ui:test     # 界面测试
npm run ui:build    # 编译界面到 ui/dist（和 iimos build 同一套选项）
npm run check       # 语法检查
npm run format      # 格式化
```

界面的第三方库用 `iimos add <包>` 装进 `ui/vendor/`（仓库里已装 react-router、zustand、marked），React 用 launcher 自带的。

## 数据

数据目录由 launcher 给（`IIMOS_DATA`），不经 launcher 时用 `AGENT_HOME` 或系统默认位置。里面是 `config.json`（模型配置，
`responsesUrl` / `apiKey` / `model` 三项是 launcher 契约定的，所有形态共用）、`chat.db`（对话）和 `images/`（图片）。
