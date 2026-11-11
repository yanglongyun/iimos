# AGENT.md

> 这份文档由你(mindmap 形态里的 agent)维护,写给下一次的你自己。结构变了、加了功能、定了约定、踩了坑,就改这里。
> 每一轮你都会读到它,写错了下一次的你就会被带偏。

## 这是什么

mindmap 是 iimos 的一个形态:一张会生长的思维导图。左边是和用户的对话,右边是同一张图的画布 ——
中心主题在中间,分支向右生长。每个节点是一个主题,可以带一段 note;用户和 agent 改的是同一份数据。

用户写下一个中心主题,首轮 agent 先搭 3–6 个主要分支;之后用户选中任意主题继续聊,agent 用工具增删改移。
模型用用户自己的(BYOK),配置在 `$IIMOS_DATA/config.json`,三项契约字段不动。

## 目录

```text
main.js             入口(纯 Node):起本地服务 → globalThis.iimos.ready({ url, window })
server/
  index.js          本地 HTTP 服务(只听 127.0.0.1,每个请求要令牌):托管 ui/,/api 分发,一条 SSE 推全部事件
  config.js         $IIMOS_DATA/config.json 读写:responsesUrl / apiKey / model 三项是契约定的,别的形态写的字段原样保留
  db.js             node:sqlite,$IIMOS_DATA/mindmap/mindmap.db:projects / nodes / messages / compactions / chats
  chat.js           每张导图一条对话:存消息、起 agent 循环、接九种事件(存库 + 推给界面)、压缩标记
  instructions.js   模型指令 = agent/prompt.md + 本文件,每轮现读
  agent/            Agent 循环(从出厂应用复制,只管「模型 → 工具 → 模型」,不碰存储)
    tools.js        工具定义:add_topics、update_topic、move_topic、delete_topic、read_map、shell
    runner.js       按名字分发到 functions/
    functions/map.js  导图工具实现(通过 config.canvas 拿到数据库、当前导图)
    functions/shell.js 出厂的 shell
    compact.js      上下文压缩
    prompt.md       角色提示词
  ai/index.js       模型请求(Responses 流式),网络失败 / 429 / 5xx 自动重试
ui/                 界面:React + TSX,编译到 ui/dist(产物进 git,回滚瞬间可用)
  src/App.tsx       两屏:首页 #/ 和导图页 #/p/<id>(对话 | 分隔条 | 画布);模型配置浮层
  src/components/MindCanvas.tsx  导图工作区:画布/大纲切换、改名、工具栏
  src/mindmap/engine.ts          参考 mindmap 应用的 SVG 画布引擎(原生 DOM,不依赖 React)
  src/mindmap/adapter.ts         引擎的三个持久化出口 → 本形态 HTTP 接口
  src/mindmap/Toolbar.tsx        子主题 / 同级 / 删除 / 缩放 / 适应
  src/mindmap/Outline.tsx        大纲视图与复制 Markdown
  src/components/Home.tsx        首页:输入中心主题、历史导图
  src/style.css                  从 ramify 继承的纸墨底(聊天、布局)
  src/mindmap.css                苔绿配色 + 参考画布样式
test/                node --test,假模型跑完整个流程;launcher 播种时不带这个目录
```

## 数据

- `projects` 一行 = 一张导图;`nodes` 一行 = 一个主题。
- `nodes.parent_id` 为 NULL 的是中心主题,一张图只有一个;`position` 是同级排序。
- `title` 短标题;`note` 是补充说明,可以为空。
- 用户数据全部在 `$IIMOS_DATA/mindmap/`。workspace 里不能出现 `.data`、数据库或用户内容。
- 对话条目原样存 `messages`(Responses 协议的 input item);用户消息多两个只给界面看的字段:`display`(原话)和 `node`(选中的主题),发给模型前剥掉。
- 压缩:一条 compaction = 覆盖到某条消息为止的摘要;下次上下文 = 最近摘要 + 它之后的消息。

## 约定

- 节点是主题,不是作品。不要写 HTML / Markdown 长文进 note;note 最多一两句。
- 所有导图修改都走工具;不要用 shell 直接改 SQLite。
- 同一张图一次只跑一轮;回复中再发消息是 409;停止走 `POST /api/projects/:id/stop`。
- 首轮先 read_map 再 add_topics;一次加 3–6 个,不要一次铺满所有叶子。
- 删除不可恢复,只有用户明确要求时才 delete_topic;中心主题不能删、不能移。
- 界面画布用参考 mindmap 应用的 SVG 引擎(`ui/src/mindmap/engine.ts`),支持双击改、Tab/Enter 增主题、拖动换父、折叠、缩放和大纲视图。
- 同级排序:画布把主题拖到同侧兄弟的上下边缘或间隙,中央仍是换父;也可选中后按 Alt+↑/↓。`POST /api/topics/:id/reorder` 在事务里重编号同级主题,一次 `nodes` 事件同步画布与大纲。
- 界面手动操作和 agent 走同一套 API,SSE 会把变化同步回画布;引擎原地 `setTopics`,不重建,保留缩放和选中。
- 中心的直接子主题有 `side`(`left` / `right`),深层主题跟随祖先侧;布局和连线由引擎负责。
- 加前端库:`iimos add <包>`,之后照常 import。React 不用装。
- 改了 server/ 或 main.js 要 `iimos restart`;只改了 ui/ 用 `iimos reload`。每改完一件事 `iimos snapshot "说明"`。

## 验证

```sh
npm test       # 服务端测试(假模型,不联网;需要 node 22.5+)
npm run build  # 编译界面
```
