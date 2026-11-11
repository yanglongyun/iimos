# 聊天层

聊天层把 Agent 接到界面上：把对话存进数据库，把 Agent 的事件推给前端。代码在 `server/api/sessions/[id]/messages/post.js`（运行一轮）和 `server/api/events/`（事件通道）。

原则只有一条：**前端收到的事件就是 Agent 的九种事件**，聊天层不另造事件，只补上它知道的信息。前端的操作全部走 HTTP，事件通道只往下推。

## 事件

每个事件都带 `session_id`。完整 item 到了先存库，推出去时带上数据库 `id` 和 `created_at`。

| 事件                   | 内容                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `message`              | 流式 `{ delta }`；完整 `{ item, id, created_at }`。用户发的消息也是这个事件，作为一轮的开头                               |
| `reasoning`            | 流式 `{ delta }`；完整 `{ item, id, created_at }`                                                                         |
| `function_call`        | `{ item, id, created_at }`                                                                                                |
| `function_call_output` | `{ item, id, created_at }`                                                                                                |
| `retry`                | `{ attempt, maxRetries, delayMs, error }`                                                                                 |
| `usage`                | `{ usage }`                                                                                                               |
| `compact`              | 开始 `{ status: "started" }`；完成 `{ status: "completed", id, message_id, summary, created_at }`，后四项是存好的压缩记录 |
| `error`                | `{ code, error }`                                                                                                         |
| `done`                 | `{ status, stopReason }`，一轮的最后一个                                                                                  |

事件的含义和顺序见 [Agent](./agent.md)。聊天层只多了一件事：一轮以用户消息的 `message` 开头。

```text
message(用户) → [compact] → reasoning / message 的 delta …
→ reasoning / message / function_call 的 item → usage
→ function_call_output … → 循环 … → [error] → done
```

## 事件通道

`GET /api/events`，一条 SSE 长连接，整个应用共用，只往下推。每个事件是一行 `data: {...}`。

所有会话的事件都推给所有连接，前端按 `session_id` 取用：当前打开的对话更新消息，其他会话只更新列表里的运行状态。只有一个本地窗口，推送量很小，不需要订阅。

列表只在状态真正变化时更新：开始运行、结束运行、有新的完整消息。流式增量和用量对列表没有变化，直接跳过，后台会话再多也不会频繁重排。

断开不影响运行。浏览器的 `EventSource` 会自动重连（服务端设定 1.5 秒），连上时前端重新拉一次会话列表和当前对话，补上断开期间错过的内容。事件不编号，也不按 `Last-Event-ID` 补发：完整 item 都在数据库里，流式文字在打开对话时返回，重拉一次就补齐了。

## 操作

| 操作         | 接口                                          |
| ------------ | --------------------------------------------- |
| 会话列表     | `GET /api/sessions`，滚到底时带 `before` 翻页 |
| 打开对话     | `GET /api/sessions/:id`                       |
| 翻更早的消息 | `GET /api/sessions/:id/messages?before=`      |
| 发消息       | `POST /api/sessions/:id/messages`             |
| 停止         | `DELETE /api/sessions/:id/run`                |
| 新建         | `POST /api/sessions`                          |
| 改名、置顶   | `PATCH /api/sessions/:id`                     |
| 置顶排序     | `PUT /api/sessions/pins`                      |
| 删除         | `DELETE /api/sessions/:id`                    |

新建、改名、置顶、排序、删除的结果看 HTTP 响应，不再推送。

左侧列表只由列表接口加载。其他地方只改某一行自己动过的字段：改名只改标题，置顶只改置顶状态和顺序，事件只改运行状态和更新时间；打开对话不碰列表。

### 会话列表

第一页是全部置顶对话加最近更新的 50 个，`has_more` 表示还有更早的。列表滚到底时，以已加载的最后一个未置顶对话为起点继续取：`?before=<updated_at>&before_id=<id>`，只返回未置顶的，每次 50 个。

### 打开对话

`GET /api/sessions/:id` 返回最近 60 条消息、`has_more`、压缩记录、`running`（是否正在运行），以及 `streaming`：

- 没在运行时为 `null`；
- 正在运行时是 `{ text, reasoning }`，即已经流式输出、但还没形成完整 item 的文字。这是唯一从内存里取的内容。

打开时可能有事件正在推来。完整 item 都带 `id`，前端按 `id` 和 GET 的结果合并，重复的直接跳过；流式文字接在 `streaming` 后面继续拼。

### 发消息

`POST /api/sessions/:id/messages`，`{ text, images }`。`images` 是先通过 `POST /api/sessions/:id/images` 上传拿到的地址，最多 5 张。

校验通过后，存好用户消息，推送它的 `message` 事件，返回 `201 { id, created_at }`；回复在后台继续，过程全部通过事件推送。这个会话正在运行时返回 409。

### 停止

`DELETE /api/sessions/:id/run`。中止这一轮，等 `done` 推送之后才返回 `{ stopped: true }`；没有在运行就返回 `{ stopped: false }`。

## 存库

来一条存一条：

- 用户消息在发消息时存；
- 模型的每个完整 item、每个工具结果，到了就存，存好再推；
- `usage` 到达时，补写到这次模型响应的最后一条上；
- 压缩完成时存压缩记录，存好 Agent 才替换上下文、继续请求。

工具跑到一半被停止，或者运行失败，数据库里可能留下没有结果的 `function_call`，下次请求模型会出错。所以这一轮结束、推送 `done` 之前，给每个这样的调用补一条结果再推送：

```json
{ "success": false, "text": "已停止" }
```

下次请求时，模型能看到这个调用被停了。

## 内存里的状态

正在运行的回复记在 `context.runs` 里：会话 ID → `{ controller, done, text, reasoning }`。

- `controller` 用来停止；
- `done` 是这一轮的 Promise，停止接口和服务关闭时等它结束；
- `text`、`reasoning` 是还没形成完整 item 的流式文字，供打开对话时返回。

同一会话不能同时运行两轮；不同会话可以并行。服务重启后内存清空，已存的消息都在数据库里。

## 前提

客户端只开一个窗口。多个窗口之间不同步改名、删除这类操作。
