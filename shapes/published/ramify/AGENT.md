# AGENT.md

> 这份文档由你(ramify 形态里的 agent)维护,写给下一次的你自己。结构变了、加了功能、定了约定、踩了坑,就改这里。
> 每一个生成批次你都会读到它,写错了下一次的你就会被带偏。下面是出厂时的样子。

## 这是什么

ramify 是 iimos 的一个形态:项目页三栏 —— **左边对话,中间画布,右边预览**。用户在对话里和你说话(首屏那句需求就是对话的
第一条),你把方案长在画布的树上:每个作品(HTML / Markdown / SVG)是一个能预览的节点;用户选中某个节点再说话,那句话就带着
这个节点作为上下文;点节点的「发散」直接从它分叉,旧方案不动。模型用用户自己的(BYOK),配置在 `$IIMOS_DATA/config.json`。

每个项目一条对话、一个 agent 循环(同一项目一次只跑一轮,不同项目可以同时跑)。四个工具:add_nodes、write_node、read_tree、shell。

## 目录

```text
main.js             入口(纯 Node):起本地服务 → globalThis.iimos.ready({ url, window })
server/
  index.js          本地 HTTP 服务(只听 127.0.0.1,每个请求要令牌):托管 ui/,/api 分发,一条 SSE 推全部事件
  config.js         $IIMOS_DATA/config.json 读写:responsesUrl / apiKey / model 三项是契约定的,别的形态写的字段原样保留
  db.js             node:sqlite,$IIMOS_DATA/ramify/ramify.db:projects / nodes / messages / compactions / chats,建表语句在这里,不写迁移
  chat.js           每个项目一条对话:存用户消息、起 agent 循环、接九种事件(存库 + 推给界面)、压缩标记
  render.js         节点内容 → 完整 HTML(markdown 走 vendor/marked.js,svg 居中放在纸上)
  instructions.js   模型指令 = agent/prompt.md + 本文件,每轮现读
  agent/            Agent 循环(从出厂应用复制,只管「模型 → 工具 → 模型」,不碰存储)
    index.js        run():模型、压缩、工具循环,九种事件
    tools.js        四个工具的定义:add_nodes、write_node、read_tree、shell
    runner.js       按名字分发到 functions/
    functions/nodes.js   add_nodes / write_node / read_tree 的实现(通过 config.canvas 拿到数据库、当前项目和本轮 id)
    functions/shell.js   出厂的 shell
    compact.js      上下文压缩:上一次响应的 total_tokens 到窗口的 70% 就把早期消息写成摘要
    prompt.md       你的角色提示词
  ai/index.js       模型请求(Responses 流式),网络失败 / 429 / 5xx 自动重试;retryAfterDelivery 让断流也整段重来
  vendor/marked.js  Markdown 渲染(从 esm.sh 打的单文件,服务端没有 npm)
ui/                 界面:React + TSX,iimos build 编译到 ui/dist(产物进 git,回滚瞬间可用)
  src/App.tsx       两屏:首页 #/ 和项目页 #/p/<id>(对话 | 分隔条 | 画布 + 预览);模型配置浮层;选中节点的状态在这里
  src/store.ts      GET /api/projects/:id 拿全量(树 + 对话 + 运行态),SSE 接 delta / item / state / node / … 事件
  src/lib/chat.ts   存库的条目 → 对话里的行(用户气泡、回复、工具调用合成一行、压缩标记、本地提示)
  src/lib/markdown.ts  回复的 Markdown 渲染(不渲染原始 HTML / 图片)
  src/lib/plants.ts  Flora 植物图鉴(10 株):首页标题上随机摇曳一株,生成中的卡片按节点 id 抽一株
  src/components/   Home、ChatPanel(MessageStream + ToolGroup + 输入框)、PaneDivider、Canvas(树)、NodeCard、Bubble(发散气泡)、Preview、Minimap、Setup
  src/lib/          layout.ts 横向树布局(节点尺寸要和 style.css 一致)、viewport.ts 平移缩放
  vendor/           iimos add 装的第三方库:marked
test/               node --test,假模型跑完整个流程;launcher 播种时不带这个目录
```

## 数据

- 节点只有一种,`type` 决定内容:`text` 是标题节点(根 = 需求,每次发散的「轮」= 修改要求,content 为空);
  `html / markdown / svg` 是作品,content 是完整源码,NULL 表示生成中;`error` 的 content 是失败原因。
- `parent_id + position` 定树形。`add_nodes` 带 round 时先在被选中的节点下插一个轮节点,占位挂在轮下面 —— 旧节点一个都不动。
- 对话条目原样存 messages 表(Responses 协议的 input item);用户消息多两个只给界面看的字段:`display`(原话)和
  `node`(选中的节点、要几版),发给模型前剥掉;发给模型的正文里附着选中节点的完整内容和「出几版」的要求(chat.js composeUserText)。
- 压缩:compactions 表一行 = 覆盖到某条消息为止的摘要;下次上下文 = 最近一条摘要 + 它之后的消息。tokens 记在 chats 表。
- 一轮结束时,这一轮(nodes.run_id)还空着的占位节点标成 error;进程启动时所有空着的作品节点一律标失败。

## 约定

- 作品一律用 `write_node` 写进节点;`shell` 只用来查资料、算东西、看源码。
- 事件推送沿用 agentic 那套:一条 SSE,把 agent 的九种事件(加 node / config / project)推给界面;界面的操作全走 HTTP。
- 同一项目回复中再发消息是 409;停止走 POST /api/projects/:id/stop。
- 缩略图 iframe 用 `sandbox=""`(不跑脚本),右侧预览用 `sandbox="allow-scripts"`(不给 same-origin,脚本拿不到令牌)。
- `config.json` 所有形态共用:responsesUrl / apiKey / model 别改意思,别的字段原样保留。
- 加工具:tools.js 加定义 + functions/ 加实现 + runner.js 加分发,然后 `iimos restart`。
- 加前端库:`iimos add <包>`,之后照常 import。React 不用装。

## 验证

```sh
npm test       # 服务端测试(假模型,不联网;需要 node 22.5+)
iimos build    # 编译界面
```

改了 server/ 或 main.js 要 `iimos restart`;只改了 ui/ 用 `iimos reload`。每改完一件事 `iimos snapshot "说明"`。
