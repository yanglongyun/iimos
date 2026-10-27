# Agent

代码在 `server/agent/`，模型请求在 `server/ai/`。Agent 只做一件事：拿到一段对话，循环调用模型和工具，直到模型不再调用工具为止，过程通过事件交给调用方。它不读写数据库，不拼提示词，也不知道会话、界面和事件通道的存在。

## 基本原理

### 入口

```js
run({ instructions, messages, model, config, usage, signal, onEvent });
```

| 参数           | 说明                                                              |
| -------------- | ----------------------------------------------------------------- |
| `instructions` | 系统提示词，调用方已渲染好变量，Agent 原样发给模型                |
| `messages`     | 上下文数组，Responses 格式的 item，最后一条是本次用户输入         |
| `model`        | 模型 ID                                                           |
| `config`       | 模型地址、Key、压缩参数、工作目录、工具超时和输出上限等           |
| `usage`        | 上一次模型响应的用量，用来判断开始前是否需要压缩；没有就传 `null` |
| `signal`       | 取消信号；停止和整轮超时都通过它                                  |
| `onEvent`      | 事件回调。Agent 会 `await` 它，回调抛错会终止本次运行             |

### 循环

```text
┌─> 用量超过阈值？ ── 是 ──> 压缩上下文
│        │
│        ▼
│   请求模型（流式）
│        │
│        ▼
│   输出原样追加到 messages
│        │
│        ▼
│   有工具调用？ ── 否 ──> 结束
│        │ 是
│        ▼
│   依次执行工具，结果追加到 messages
└────────┘
```

1. 每轮开始先看用量：`usage.total_tokens >= config.compact_at` 就先压缩。
2. 请求模型。请求体是 `instructions`、`input`、`model`、`tools`、`store: false`，始终流式。
3. 拿到完整响应后先校验：输出只能是 `message`、`reasoning`、`function_call` 三种，工具调用必须带 `call_id`。校验不过整轮失败，不执行任何工具。
4. 输出按顺序原样追加到 `messages`，作为下一次请求的上下文。
5. 没有工具调用就结束；有就按顺序逐个执行，每个结果作为 `function_call_output` 追加，再回到第 1 步。

`messages` 是调用方传进来的数组，Agent 直接在上面追加，循环中不重新查库。

### 模型请求与重试

模型接口是 Responses 格式的完整地址，`authorization: Bearer <key>`。图片在数据库里只存 `/api/images/文件名`，发请求前临时读文件换成 data URL，原消息不变。

一次请求最多尝试 3 次，间隔 2 秒、4 秒。只有以下情况重试，且前提是还没有向外交付过任何增量：

- 网络请求失败；
- HTTP 429 或 5xx；
- 流在 `response.completed` 之前断开。

协议错误、JSON 错误、模型拒绝、`response.incomplete` 都不重试，直接失败。

### 结束与失败

| 情况                      | `done.status` | `stopReason`                              |
| ------------------------- | ------------- | ----------------------------------------- |
| 模型不再调用工具          | `completed`   | 无                                        |
| 用户停止                  | `aborted`     | `aborted`                                 |
| 整轮超时（`run_timeout`） | `incomplete`  | `timeout`                                 |
| 模型、压缩或回调出错      | `incomplete`  | 错误码，如 `http_500`、`model_incomplete` |

工具执行失败不算运行失败：错误作为工具结果交给模型，循环继续。

## 工具

四个本机工具加一个 browser 工具，定义在 `tools.js`，实现在 `functions/`。browser 经 launcher 转给 iimos 的浏览器插件。相对路径都以 `config.workdir` 为基准，没设置时用服务进程的当前目录（launcher 下就是形态自己的目录）。

| 工具      | 参数                                                                           | 行为                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`   | `command`，可选 `workdir`                                                      | macOS 用 bash（没有则 sh），Windows 用 PowerShell。超时 `config.timeout` 秒后杀掉整个进程组。stdout 和 stderr 合并，超过 `max_output` 截断，末尾附退出码                                                                         |
| `read`    | `path`，可选 `offset`（默认 1）、`limit`（默认 2000）                          | 文本带行号返回，最大 32 MiB，超过 `max_output` 截断；PNG / JPEG / GIF / WebP 最大 5 MiB，存进图片目录后作为图片交给模型；二进制文件拒绝                                                                                          |
| `write`   | `path`、`content`                                                              | 整个文件写入，自动创建父目录                                                                                                                                                                                                     |
| `edit`    | `path`、`old_string`、`new_string`，可选 `replace_all`                         | 精确替换。文件最大 2 MiB；默认要求只匹配一处，多处匹配需要 `replace_all`                                                                                                                                                         |
| `browser` | `action`（tabs / open / close / cdp），按需带 `tab`、`url`、`method`、`params` | 标签页用插件接口管理，只能操作自己 open 的标签页，每个对话一个以标题命名的标签组。页面里的一切操作用 `cdp` 原样转发 Chrome 开发者工具协议命令，结果原样返回；脚本出错算工具失败；`Page.captureScreenshot` 的结果存成图片交给模型 |

工具结果统一放在 `function_call_output.output`：

```json
{ "success": true, "text": "…" }
```

以 JSON 字符串存放。`read` 读到图片时，`output` 改为数组：一段上面的文本，加一个 `input_image`。

参数不是合法 JSON、工具名不存在、执行抛错，都变成 `success: false` 的结果交给模型；只有取消会中断工具。

## 上下文压缩

对话越来越长时，把早期消息总结成一段摘要，替换掉原消息，后面的请求只带摘要和最近的消息。

### 何时压缩

每轮请求模型之前检查上一次响应的 `usage.total_tokens`，达到 `compact_at`（默认 60000）就压缩。判断只用模型实际返回的用量，不自己估算。压缩后把 `usage` 清空，下一次响应的用量再决定要不要压。

### 压到哪里

保留最近 `keep` 条（默认 20）不动，只在更早的部分里找切点。切点必须让工具调用和它的结果留在同一侧，所以只能落在：

- 一组工具调用的结果全部返回之后；
- 或者下一条是用户消息的位置。

取满足条件的最靠后的位置。消息总数不超过 `keep + 2`，或找不到切点，就不压缩。

### 怎么压

单独请求一次模型，不带工具：

- 指令是 `compact_system`，默认要求写成中文交接摘要，保留目标、要求、完成事项、改过的文件、当前进度、待办和关键命令；
- 输入是一条用户消息，内容是要压缩的那些 item，每行一个 JSON。

摘要为空算失败。成功后生成一条用户消息，内容是 `compact_prefix`（默认“以下是历史上下文压缩摘要：”）加摘要，替换 `messages` 里被压缩的那段。

替换发生在 `compact` 完成事件交付之后。调用方在回调里保存摘要，保存失败就抛错，Agent 不会替换上下文，本次运行终止。

数据库里原始消息不删。调用方记录摘要覆盖到哪条消息，下次组装上下文时用“最新摘要 + 之后的消息”。

## 事件

Agent 只向外发九种事件，都通过 `onEvent` 交付。

| 事件                   | 内容                                                                                  | 时机                                       |
| ---------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| `message`              | 流式时 `{ delta }`；完成时 `{ item }`                                                 | 正文增量；响应完成后交付完整消息           |
| `reasoning`            | 流式时 `{ delta }`；完成时 `{ item }`                                                 | 思考增量；响应完成后交付完整思考           |
| `function_call`        | `{ item }`                                                                            | 响应完成后，按输出顺序交付                 |
| `function_call_output` | `{ item }`                                                                            | 每个工具执行完                             |
| `retry`                | `{ attempt, maxRetries, delayMs, error }`                                             | 模型请求失败、等待重试之前                 |
| `usage`                | `{ usage }`，没有用量时为 `null`                                                      | 每次模型响应的完整输出交付之后             |
| `compact`              | 开始 `{ status: "started" }`；完成 `{ status: "completed", item, start, end, usage }` | 压缩前后                                   |
| `error`                | `{ code, error }`                                                                     | 运行失败时，在 `done` 之前                 |
| `done`                 | `{ status, stopReason? }`                                                             | 永远最后一个，无论成功、失败还是取消都会发 |

### 一轮的顺序

```text
[compact started → (retry …) → compact completed]   需要压缩时
(retry …)                                           请求失败重试时
message / reasoning 的 delta …                      流式增量
message / reasoning / function_call 的 item …       完整输出，按模型输出顺序
usage
function_call_output …                              每个工具一个
→ 有工具调用就回到开头，否则：
[error]
done
```

几点约定：

- 增量只用于显示，完整的 item 才是要保存的内容；同一段内容会先以 `delta` 出现，再以 `item` 出现一次。
- `usage` 只标志一次模型响应结束，不代表这一轮完成：之后还可能有工具结果和下一次请求。调用方等工具结果到齐后再一起保存。
- `error` 和 `done` 在取消后也会交付，调用方据此收尾。
- Agent 不给事件编号、不加时间戳，也不附带数据库 ID。这些由调用方在外层添加，原始 item 保持不变。
