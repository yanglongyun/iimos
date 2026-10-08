# AGENT.md

> 这份文档由你(iimos 里的 agent)维护,写给下一次的你自己。结构变了、加了功能、定了约定、踩了坑,
> 就改这里。下面是出厂时的样子。

## 现在有什么

只有一个对话。没有对话列表、没有设置页、没有别的功能 —— 这些都等用户要了再做。

## 目录

```text
desktop/main.js     Electron 主进程:起本地服务 → 开窗口 → 页面加载完调 globalThis.iimos.ready()
server/             业务层
  index.js          本地 HTTP 服务(只听 127.0.0.1,接口要令牌):托管 ui/、对话接口、SSE 事件流
  conversation.js   唯一的那个对话:准备上下文、调 agent 的 run()、接它的事件存盘并推给界面
  instructions.js   主模型的指令:prompt.md + launcher 契约 + 本文件 + 回滚 / 升级通知,每轮现读
  config.js         模型配置 $IIMOS_DATA/config.json(位置是 launcher 契约定的,别挪),含上下文窗口
agent/              agent 循环,只管「模型 → 工具 → 模型」,不碰存储
  index.js          run():接收上下文,执行模型、压缩和工具循环,通过 onEvent 输出九种事件
  tools.js          工具定义(只放定义)。加工具:这里加定义 + functions/ 加实现 + runner.js 加分发
  runner.js         按名字分发工具调用,出错作为失败结果交回模型
  functions/        shell / read / write / edit 各一个文件
  compact.js        上下文压缩:用量到窗口 70% 时,留最后 20 条,之前的写成交接摘要
  prompt.md         你的基础提示词
ai/index.js         模型请求(Responses 流式),网络失败 / 429 / 5xx / 断流自动重试两次
ui/                 界面:React + TypeScript
  index.html        只引用 dist/main.js 和 dist/main.css
  src/main.tsx      入口;App.tsx 布局;store.ts 状态与 SSE;components/ 各块界面;style.css 终端风格样式
  dist/             编译产物(iimos reload / build 生成),跟着源码一起进快照
  tsconfig.json     只给编辑器用,运行时不做类型检查
package.json        version 是出厂版本号
```

## 上下文压缩

对话只有一个、永远不结束,所以压缩是必备的。agent 每次请求模型前看上一次响应报的 `usage.total_tokens`,
到了用户填的上下文窗口的 70%,就留最后 20 条,把之前的交给模型写成交接摘要,摘要作为一条用户消息替换掉那段上下文。
conversation.js 在对话里插一条 `{ type: 'compaction', summary, item }` 标记存下来,原始条目一条不删,界面照样能往上翻。
发给模型的上下文由 `liveItems()` 从最近一个标记开始取。改对话存储或发请求的逻辑时别绕过它。

## 重启接续

`iimos restart` 会把应用连同正在跑的这一轮一起重启。launcher 重启前调 `server.close({ restarting: true })`,
conversation.js 把这一轮记成 interrupted;新进程起来后 `resumeIfInterrupted()` 在日志里插一条
`{ type: 'restart' }`,把这一轮接着跑完。这条标记发给模型时是一条「[launcher] 重启完成」的消息(liveItems),
让它知道重启已经过去了 —— 只写进系统指令不够,它会只信自己上一步 restart 返回的「马上重启」。
连续接续最多 3 次,用户一开口就清零。
改 desktop/main.js 或 server/index.js 时,别丢了这两个调用。

## 约定

- 界面改完 `iimos reload`:先编译,通过了才重载。编不过窗口不动,看错误改。
- react / react-dom 由 launcher 提供(IIMOS_TOOLCHAIN),直接 import;没有 npm,别 npm install。
- 其他前端库用 `iimos add <包>`:打成单文件放进 ui/vendor/,记在 ui/vendor/vendor.json,编译时自动走别名,照常 import。
- 新功能做成 components/ 下的组件,挂进 App.tsx 的布局里;状态从服务端来的走 store.ts。
- 新功能的数据放 `$IIMOS_DATA` 下,不放 workspace(回滚只回代码)。
- 改了 server/ agent/ desktop/ 要 `iimos restart`;只改 ui/ 用 `iimos reload`。

## 记录

(还没有。每次加了什么、为什么这么做,记在这里。)
