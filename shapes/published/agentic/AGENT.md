# AGENT.md

> 这份文档由你（agentic 形态里的 agent）维护，写给下一次的你自己。结构变了、加了功能、定了约定、踩了坑，就改这里。
> 你每一轮都会读到它，写错了下一次的你就会被带偏。下面是出厂时的样子。

## 这是什么

agentic 是 iimos 的一个形态：类 ChatGPT 的界面，左侧对话列表（重命名、删除、置顶、置顶组拖拽排序），右侧对话。
五个工具：shell、read、write、edit、browser。模型用用户自己的（BYOK），配置在 `$IIMOS_DATA/config.json`。

你跑在 launcher 拉起的子进程里，脚下这个目录（workspace）就是你自己的源码，全都可以改。改完 `iimos reload`（只改了 ui/）
或 `iimos restart`（改了 server/ 或 main.js）；每改完一件事 `iimos snapshot "说明"`。细节见 launcher 契约（每轮都在你的指令里）。

## 目录

```text
main.js             入口（纯 Node）：起本地服务 → globalThis.iimos.ready({ url })；浏览器工具的命令经 iimos.call 转给 launcher
server/
  index.js          本地 HTTP 服务（只听 127.0.0.1）：托管 ui/，/api 分发；窗口第一次带 ?token= 打开，换成 HttpOnly Cookie
  config.js         数据目录（$IIMOS_DATA）、配置读写校验、提示词变量渲染
  defaults.json     默认配置和提示词
  instructions.js   主模型的指令：设置里的提示词 + launcher 契约 + 本文件 + 回滚通知，每轮现读
  schema.sql        数据库表结构：sessions、messages、compactions 三张表，启动时执行，不写迁移
  db.js             打开 SQLite（node:sqlite）
  images.js         图片文件保存与读取（数据目录 images/）
  api/              按 URL 路径分目录，每层 index.js 分发，GET / POST 等各一个文件；SQL 直接写在接口里
    authorize.js    校验令牌 Cookie
    events/         GET /api/events：一条 SSE，把 Agent 的九种事件推给界面
    sessions/       列表（分页）、新建、打开、改名置顶、排序、删除、历史消息、发消息、停止、图片上传
    config/ status/ images/
  agent/            Agent 循环，只管「模型 → 工具 → 模型」，不碰存储
    index.js        run()：接收上下文，执行模型、压缩和工具循环，通过 onEvent 输出九种事件
    tools.js        五个工具的定义；runner.js 按名字分发；functions/ 各工具实现
    compact.js      上下文压缩：上次响应的 usage.total_tokens 到 compact_at 就把早期消息写成交接摘要
  ai/index.js       模型请求（Responses 流式），网络失败 / 429 / 5xx / 断流自动重试两次；images.js 把图片地址换成 data URL
  tests/            node --test；fixture.js 起一个带假模型的服务
ui/                 界面：React + TypeScript
  index.html        只引用 dist/main.js 和 dist/main.css
  src/main.tsx      入口；router.tsx 路由（/、/sessions/:id、/settings）；shell/ 侧栏与设置；thread/ 对话、事件、store
  vendor/           iimos add 装的第三方库（react-router、zustand、marked），vendor.json 记着来源
  dist/             编译产物（iimos reload / build 生成），跟着源码一起进快照
package.json        version 是出厂版本号；iimos.contract 是需要的 launcher 契约版本
.dev/               设计文档：agent.md（Agent 原理）、chat.md（聊天层与事件）
```

## 约定

- 聊天层的事件就是 Agent 的九种事件（message、reasoning、function_call、function_call_output、retry、usage、compact、error、done），
  只补 session_id，完整 item 存库后带上 id 和 created_at 再推送。界面的操作全走 HTTP，SSE 只往下推。
- 来一条存一条；停止或失败时给没有结果的工具调用补一条 `{ success: false, text: "已停止" }`。
- `config.json` 是所有形态共用的：responsesUrl / apiKey / model 三项是契约定的，别改它们的意思；别的形态写的字段原样保留。
- browser 工具只有 tabs / open / close / cdp 四个操作；页面里的一切用 cdp 发 Chrome 开发者工具协议命令，
  只能操作自己 open 的标签页，每个对话一个以标题命名的标签组。插件没连上时工具返回明确的失败。
- 加工具：tools.js 加定义 + functions/ 加实现 + runner.js 加分发，然后 `iimos restart`。
- 加第三方前端库：`iimos add <包>`，之后照常 import。React 不用装。

## 验证

```sh
npm test            # 服务端测试（需要 node_modules，用 shell 跑）
npm run ui:test     # 界面测试
iimos build       # 编译界面
```

改了运行逻辑先跑测试再 restart。
