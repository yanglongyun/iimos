# AGENT.md

> 这份文档由你（messages 形态里的 agent）维护，写给下一次的你自己。结构变了、加了功能、定了约定、踩了坑，就改这里。
> 你每一轮都会读到它，写错了下一次的你就会被带偏。下面是出厂时的样子。

## 这是什么

messages 是 iimos 的一个形态：长得像 Apple「信息」（iMessage）。左边一栏是搜索框、新建对话钮和对话列表（头像、标题、最后一句预览、时间；
右键出「重命名 / 删除」；底部是全局的设置入口），右边是选中的对话：你的话是右侧蓝气泡，agent 的回复是左侧灰气泡（流式显示），思考和工具调用各折成一行，
点开看参数和结果；底部是圆角输入框 + 蓝色发送钮，回复中变成停止钮。
五个工具：shell、read、write、edit、browser。模型用用户自己的（BYOK），配置在 `$IIMOS_DATA/config.json`。

你跑在 launcher 拉起的子进程里，脚下这个目录（workspace）就是你自己的源码，全都可以改。改完 `iimos reload`（只改了 ui/）
或 `iimos restart`（改了 server/ 或 main.js）；每改完一件事 `iimos snapshot "说明"`。细节见 launcher 契约（每轮都在你的指令里）。

## 目录

```text
main.js             入口（纯 Node）：起本地服务 → globalThis.iimos.ready({ url, window })，窗口用系统原生标题栏；浏览器工具的命令经 iimos.call 转给 launcher
server/
  index.js          本地 HTTP 服务（只听 127.0.0.1）：托管 ui/，/api 分发；窗口第一次带 ?token= 打开，换成 HttpOnly Cookie
  config.js         数据目录、配置读写校验、提示词变量渲染。config.json 在 $IIMOS_DATA 根下（所有形态共用）；本形态的数据库和图片在 $IIMOS_DATA/messages/
  defaults.json     默认配置和提示词
  instructions.js   主模型的指令：设置里的提示词 + launcher 契约 + 本文件 + 回滚通知，每轮现读
  schema.sql        数据库表结构：sessions、messages、compactions 三张表，启动时执行，不写迁移
  db.js             打开 SQLite（node:sqlite）
  images.js         图片文件保存与读取
  api/              按 URL 路径分目录，每层 index.js 分发，GET / POST 等各一个文件；SQL 直接写在接口里
    authorize.js    校验令牌 Cookie（messages_token）
    events/         GET /api/events：一条 SSE，把 Agent 的九种事件推给界面
    sessions/       列表（分页；带 ?q= 是搜索）、新建、打开、改名、删除、历史消息、发消息、停止、图片上传；pins 接口是从 agentic 带来的，界面暂不用
    config/ status/ images/
  agent/            Agent 循环，只管「模型 → 工具 → 模型」，不碰存储
    index.js        run()：接收上下文，执行模型、压缩和工具循环，通过 onEvent 输出九种事件
    tools.js        五个工具的定义；runner.js 按名字分发；functions/ 各工具实现
    compact.js      上下文压缩：上次响应的 usage.total_tokens 到 compact_at 就把早期消息写成交接摘要
  ai/index.js       模型请求（Responses 流式），网络失败 / 429 / 5xx / 断流（还没交付内容时）自动重试两次；images.js 把图片地址换成 data URL
  tests/            node --test；fixture.js 起一个带假模型的服务
ui/                 界面：React + TypeScript，Apple「信息」风格
  index.html        只引用 dist/main.js 和 dist/main.css
  src/main.tsx      入口；router.tsx 路由（/、/sessions/:id、/settings）
  src/shell/        Sidebar.tsx 左栏（搜索、新建、列表、右键菜单、重命名 / 删除弹窗、底部设置入口）；Settings.tsx 设置页
  src/thread/       右栏：index.tsx 顶栏；MessageStream.tsx 气泡流；Steps.tsx 思考 / 工具行与「正在输入」；Composer.tsx 输入区；
                    store.ts 状态与接口调用；thread.ts 把消息记录变成显示行；events.ts 事件类型；stream.ts SSE；format.tsx markdown 与时间
  src/styles/       tokens.css 颜色令牌（浅色 / 深色）；base.css 基底；app.css 全部布局和气泡
  src/icons/Icon.tsx 线性图标与头像
  vendor/           iimos add 装的第三方库（react-router、zustand、marked），vendor.json 记着来源
  dist/             编译产物（iimos reload / build 生成），跟着源码一起进快照
package.json        version 是出厂版本号；iimos.contract 是需要的 launcher 契约版本（1，不需要终端）
```

## 约定

- 聊天层的事件就是 Agent 的九种事件（message、reasoning、function_call、function_call_output、retry、usage、compact、error、done），
  只补 session_id，完整 item 存库后带上 id 和 created_at 再推送。界面的操作全走 HTTP，SSE 只往下推。
- 来一条存一条；停止或失败时给没有结果的工具调用补一条 `{ success: false, text: "已停止" }`。
- 列表每行带 `subject`（第一条用户消息，没起标题时当标题）和 `preview`（最后一条正文，列表里的预览）、`last_role`（预览前要不要加「你：」）。
  搜索走服务端 `GET /api/sessions?q=`：标题或任一条消息正文包含就算命中，取最近 50 个。
- 气泡：同一人连发挨得近，换人时多空一点（不画小尾巴）；隔 15 分钟以上插一条时间标签。正文还没流出来时显示三个点的「正在输入」。
- 正文是流式展示的，所以 ai/index.js 不开 `retryAfterDelivery`（已交付增量再重试会把前半段重复给用户看）；断流只在还没交付内容时重试。
- `config.json` 是所有形态共用的：responsesUrl / apiKey / model 三项是契约定的，别改它们的意思；别的形态写的字段原样保留。
  本形态自己的数据库 `chat.db` 和 `images/` 在 `$IIMOS_DATA/messages/` 下。
- browser 工具只有 tabs / open / close / cdp 四个操作；页面里的一切用 cdp 发 Chrome 开发者工具协议命令，
  只能操作自己 open 的标签页，每个对话一个以标题命名的标签组。插件没连上时工具返回明确的失败。
- 加工具：tools.js 加定义 + functions/ 加实现 + runner.js 加分发 + format.tsx 的 toolMeta 加一行文案，然后 `iimos restart`。
- 加第三方前端库：`iimos add <包>`，之后照常 import。React 不用装。
- 深色模式跟系统（theme.ts 把结果写到 `<html data-theme>`），颜色只从 tokens.css 取。

## 验证

```sh
npm test            # 服务端测试（需要 node_modules，用 shell 跑）
npm run ui:test     # 界面测试
iimos build         # 编译界面
```

改了运行逻辑先跑测试再 restart。
