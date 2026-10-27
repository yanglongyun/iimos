# 项目代码要求

- 优先让人能直接读懂。使用普通函数、对象、数组和明确的 `if / switch / for`。
- 当前处于开发阶段，禁止任何旧版本、旧字段、旧协议、旧数据结构的兼容或迁移代码，也不保留对应测试、升级脚本和过渡分支。只实现当前确定的结构；开发数据需要重建时直接重建，不为它增加产品代码。
- 固定数据直接写字面量。工具定义直接写数组，不用工厂函数拼装。
- 不给函数动态挂属性，不用立即执行函数隐藏流程，不用隐式类型转换或位运算表达普通数字。
- 条件和循环必须写大括号。每条变量声明只声明一个变量，不写嵌套三元表达式。
- 本地数据库 DDL 统一放在 `server/schema.sql`，由 `db.js` 启动时执行，只初始化当前结构，不写迁移。
- 表字段先放标识和业务数据，时间字段放最后；messages 顺序为 id、session_id、item、usage、created_at。
- API 按 URL 路径逐层拆目录，每层用 `index.js` 分发；同一路径的多个 HTTP 方法分别写在 `get.js`、`post.js` 等文件中。
- SQL 直接写在对应 API 处理函数内，不建 repository/service 层，不封装查询、写入或事务方法。
- 注释解释用途和必要的边界处理，变量名表达含义。
- 提交改动前执行 `npm run format`，用 `npm run format:check` 检查格式。
- 修改运行逻辑后执行 `npm run check`、`npm test`；修改界面后执行 `npm run ui:build`。

## Agent 职责

- `server/agent/index.js` 是真正的消息入口和循环体，负责模型请求、压缩及事件输出。
- Agent 工具循环不设置轮数上限。
- Agent 直接使用调用方传入的消息数组，不深拷贝或另建消息副本。
- Agent 和 AI 请求入口按 instructions、messages、model 的顺序接收指令、消息和模型，再接配置等参数；主模型指令由业务层准备，Agent 原样透传。
- 主模型请求和压缩请求都使用独立的 model 参数，不从 config 读取或回退。
- 工具调用只使用标准 call_id，arguments 只接受 JSON 字符串；不得改用 id、生成替代 ID 或接受其他参数格式。
- Agent 和压缩函数直接导入 AI 请求方法，不从调用方传入模型请求函数，不传 hasSummary 状态。
- Agent 对外只发九种事件：message、reasoning、function_call、function_call_output、retry、usage、compact、done、error。
- 完整模型块按 output 原顺序交付，然后发 usage，最后执行工具；done 每次运行只发一次。
- `server/agent/runner.js` 只接收工具调用，解析参数，执行工具并返回结果。
- 每次请求模型前，根据上次模型返回的 `usage.total_tokens` 判断压缩，禁止估算或累加历史 usage。用户输入时从数据库读取，工具循环使用上次响应用量。
- `messages.usage` 保存原始 usage JSON，只附在每次模型响应最后一项；摘要必须先入库，再继续请求模型。
- 工具图片直接放在 function_call_output.output 数组中，不另造 user 消息。图片存文件，数据库和事件只存图片地址；AI 请求入口读文件转 Base64，仅用于本次请求，不修改原消息。
- `runner.js` 直接导入工具实现，`functions` 目录不设置 `index.js`。Agent 有 shell、read、write、edit 四个本机工具，加一个 browser 工具，始终提供给模型；插件没连上时 browser 返回明确的失败。不增加其他工具。

## UI 构建

- agentic 是 iimos 的一个形态：没有自己的桌面壳，`main.js` 向 launcher 报到，窗口、通知、浏览器通道都由 launcher 提供（`globalThis.iimos`）。
- 界面只有两列：左侧对话列表，右侧对话；对话右侧不设侧边面板。对话列表支持重命名、删除、置顶，置顶组内可拖拽排序；侧栏可以收起、展开和拖动调宽，状态在本机记住。置顶与顺序存在 `sessions.pin`，由服务端保存。
- 本地数据库只有 sessions、messages、compactions 三张表。正在运行的回复放在内存，图片只存文件，不为它们建表。

- 前端构建产物统一放在 `ui/dist`，由 `server/index.js` 托管 `ui/`；第三方库放 `ui/vendor/`（iimos add）。

- 前端页面由 URL 路由决定：新对话 `/`、会话 `/sessions/:id`、设置 `/settings`。不再用 page 状态或本地保存的会话 ID 决定页面。
- 聊天层的事件就是 Agent 的九种事件，不另造业务事件：只补 `session_id`，完整 item 存库后带上 `id` 和 `created_at` 再推送，不修改标准 item。前端的操作全部走 HTTP，事件通道只往下推。

- 断开事件通道不取消运行，只有停止接口或服务关闭才中止。

## 范围

- agentic 只有 BYOK 一种模式，不设云端账号、登录或模型网关。
- 浏览器控制走 launcher 的 browser 能力（插件和原生消息宿主都在 iimos 仓库）：`main.js` 把工具命令经 `iimos.call("browser.request")` 转过去。只操作 Agent 自己打开的标签页，不操作用户已开的页面。
- 没有电脑控制、远程访问、侧边面板、定时任务、应用宿主、登录页、窄屏布局、起手卡和手动主题；需要时另行设计，不保留旧代码或兼容分支。
- 本地服务只监听 127.0.0.1，每次启动生成一次性令牌，窗口第一次带 ?token= 打开后换成 HttpOnly Cookie，不落盘。
- `config.json` 由所有形态共用：只校验本形态用的字段，别的形态的字段原样保留，缺的字段补默认值。
