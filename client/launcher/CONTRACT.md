# launcher 契约

你运行在 iimos 里。iimos 分两部分:

- **launcher**:安装包里那一小块,你改不了,也不需要改。它负责启动应用、记录版本、应用起不来时把它退回上一个能用的版本,
  并提供窗口、通知、浏览器、终端这类系统能力。
- **应用**:就是你脚下这个目录(workspace,shell 的默认工作目录)。界面、本地服务、
  agent 循环、工具、你自己的提示词 —— **全在这里,全都可以改**。

你跑在用户的电脑上(macOS 或 Windows)。launcher 开窗口加载你报到的地址;菜单栏图标只有「打开」和「退出」。
**应用是纯 Node,跑在 launcher 拉起的一个子进程里,不要 import electron。** 你崩了或卡死,launcher 会把你重新拉起来;
起不来会被回滚。窗口、通知这些系统的事,通过 `globalThis.iimos` 叫 launcher 做。

出厂时应用只有一个对话,一个工具 shell。之后它长成什么样,由用户在对话里说了算:要什么,你就在这里把它做出来;
没要的,不要提前造。没有哪一块是「框架,别碰」。

## 你能用的命令

`node` 和 `iimos` 在 PATH 里(node 是 Electron 自带的那个,用户机器上不需要另装,也没有 npm)。

| 命令 | 什么时候用 |
| --- | --- |
| `iimos status` | 看当前版本、稳定版本(good)、没提交的改动 |
| `iimos snapshot "说明"` | **每改完一件事就记一笔。** 说明写给用户看,讲做了什么 |
| `iimos log` / `iimos diff [版本]` | 看历史、看改了什么 |
| `iimos add <包>[@版本]` | 装一个前端库(从 esm.sh 打成单文件放进 `ui/vendor/`,记在 `vendor.json`),之后照常 `import`。需要联网;React 不用装 |
| `iimos build` | 只编译界面:`ui/src`(React + TSX)→ `ui/dist`。编不过时 dist 不动,错误打出来 |
| `iimos reload` | 只改了 `ui/`:先编译界面,通过了才重载窗口,对话不中断;编不过窗口不动,看错误改 |
| `iimos restart` | 改了 `main.js`、`server/`:先编译界面,再整个应用重启,你这一轮也会被打断;出厂应用会在新代码起来后自动接着这一轮跑(见 AGENT.md「重启接续」)|
| `iimos rollback <版本\|good>` | 回到某个版本(当前样子会留成分支),然后重启 |
| `iimos upgrade` | 有新出厂版本、但应用被改过时,看怎么合并 |

## 改坏了怎么办

launcher 在每次启动前自动快照。重启后应用如果没在规定时间内报到(`globalThis.iimos.ready()`),
同一版本连续两次起不来,launcher 就把工作区回滚到 good,并把坏掉的版本留在 `crashed-*` 分支。
回滚发生后你会在下一轮看到通知,读 `.iimos/rollback.json` 和 `iimos status` 就知道是哪次改动出的事。
**被回滚了先告诉用户**,再决定是修好重来还是放弃那个改动。

稳定运行几分钟的版本会自动成为新的 good。所以大改动要分步:改一块 → reload/restart → 确认能用 → 再改下一块。

## 必须守住的四件事

1. `main.js` 是 launcher 加载的入口(纯 Node)。它起本地服务,然后调用 `globalThis.iimos?.ready({ url })`,
   url 是带令牌的界面地址(`http://127.0.0.1:端口/?token=…`)。launcher 打开这个地址、真的加载出来才算报到;
   不报到会被当成启动失败。
2. 用户数据不在 workspace 里,在 `IIMOS_DATA` 指向的目录。回滚只回代码,不动数据 ——
   所以改数据格式要向前兼容,别让旧版本代码读不了新数据。
3. **模型配置固定放在 `$IIMOS_DATA/config.json`**,至少含 `responsesUrl`、`apiKey`、`model` 三项
   (OpenAI Responses 协议)。别挪,也别改这三个字段的意思。
4. **`AGENT.md` 由你维护。** 它是写给下一次的你自己看的:现在的结构、各块在哪、做过的约定、踩过的坑。
   每次改了结构或加了功能,顺手更新它。你每一轮都会读到它,它写错了,下一次的你就会被带偏。

## globalThis.iimos

| 成员 | 用途 |
| --- | --- |
| `ready({ url, window? })` / `failed(err)` | 报到 / 自己知道起不来了。`window` 是桌面窗口的偏好:`{ width, height, minWidth, minHeight, title, background }`(background 是开窗时的底色,和界面底色一致就不闪)|
| `onShutdown(fn)` | 重启或退出前的收尾,`fn({ restarting })` |
| `restart()` / `reload()` | 同名命令 |
| `call(name, args)` | 叫 launcher 做一件事,返回 Promise。能力清单见下 |
| `on(name, fn)` | 订阅 launcher 发来的事件,返回取消订阅的函数 |
| `version` `workspace` `data` `seed` `bin` `contract` | 和同名环境变量一样 |

## launcher 提供的能力

`iimos.call(name, args)`,没有的能力会报错。

| 能力 | 参数 | 返回 |
| --- | --- | --- |
| `restart` / `reload` | — | 同名命令 |
| `window.open` | `{ url, width?, height?, minWidth?, minHeight?, title?, background? }` | `{ id }`,再开一个窗口加载 url(主窗口的 id 是 `main`)|
| `window.close` / `window.focus` | `{ id }` | 关掉 / 拿到前面 |
| `window.list` | — | `{ windows: [{ id, title, url }] }` |
| `notify` | `{ title, body }` | 系统通知 |
| `dialog.open` | `{ title?, directory?, multiple?, filters? }` | `{ paths }`,系统的打开文件 / 文件夹对话框,取消时为空数组 |
| `dialog.save` | `{ title?, defaultPath?, filters? }` | `{ path }`,取消时为 null |
| `dialog.message` | `{ type?, message, detail?, buttons? }` | `{ response }`,按了第几个按钮 |
| `shortcut.register` / `shortcut.unregister` | `{ accelerator }`,如 `CommandOrControl+Shift+Space` | 全局快捷键,按下时收到 `shortcut` 事件 |
| `browser.request` | `{ action, args }` | 交给浏览器插件执行:`tabs` / `open` / `close` 管标签页,`cdp` 把 Chrome 开发者工具协议命令原样转发(`args: { tab, method, params }`)。插件没连上会报错 |
| `browser.status` | — | `{ connected }` |
| `terminal.spawn` | `{ shell?, args?, cwd?, cols?, rows?, env? }` | `{ id, pid, pty, resizable, shell, cwd }`,开一个终端(默认用户的 shell,登录到 cwd)。输出走 `terminal.data` 事件。`pty` 为 true 表示是真正的伪终端(macOS 自带 expect 时还能改尺寸,`resizable`);Windows 上是普通管道,命令照常能跑但 TUI 程序不可用 |
| `terminal.write` | `{ id, data }` | 往终端里敲字(data 是字符串,回车是 `\r`)|
| `terminal.resize` | `{ id, cols, rows }` | 改尺寸;不支持时返回 `{ ok: false, reason }` |
| `terminal.kill` | `{ id, signal? }` | 结束终端 |
| `terminal.list` | — | `{ terminals: [{ id, pid, shell, cwd, cols, rows, pty }] }` |

`iimos.on(name, fn)` 能收到的事件:

| 事件 | 数据 | 什么时候 |
| --- | --- | --- |
| `shortcut` | `{ accelerator }` | 注册过的全局快捷键被按下 |
| `window.closed` | `{ id }` | 某个窗口被关掉(主窗口关掉后形态还在跑,用户点菜单栏「打开」会重开)|
| `browser.connected` / `browser.disconnected` | — | 浏览器插件连上 / 断开 |
| `terminal.data` | `{ id, data }` | 终端有输出 |
| `terminal.exit` | `{ id, code, signal, error? }` | 终端退出(起不来时带 error)|

浏览器插件在仓库根目录 `extension/`,用户自己在 Chrome / Edge 里加载;launcher 启动时把宿主登记到本机浏览器。
插件只操作你用 `open` 打开的标签页,每个 `open` 可以带 `session: { id, title }`,同一个 id 的标签页放进以 title 命名的标签组。

## 契约版本

本文件描述的能力对应契约版本 **2**。launcher 加了新能力会升版本号。形态在 `package.json` 里写它需要的最低版本:
`"iimos": { "contract": 2 }`。版本史:1 窗口 / 通知 / 对话框 / 快捷键 / 浏览器;2 加终端(`terminal.*`)。换上的形态要求的版本比当前 launcher 高,launcher 不会启动它,会提示升级 iimos。

## 环境变量

`IIMOS_WORKSPACE`(就是这里)· `IIMOS_DATA`(用户数据)· `IIMOS_SEED`(出厂版本的只读副本,想看原样时去那里找)·
`IIMOS_BIN`(node/iimos 所在目录)· `IIMOS_VERSION`(launcher 版本)· `IIMOS_CONTRACT`(本文件)·
`IIMOS_TOOLCHAIN`(launcher 带的 esbuild、react、react-dom 所在的 node_modules,界面编译时 import 'react' 就从这里找)

## 界面编译

`ui/src/main.tsx` 是入口,编到 `ui/dist/main.js` 和 `main.css`,`ui/index.html` 引用它们。
`ui/dist` 要跟着源码一起进快照 —— 回滚时直接拿到能跑的界面,不用重新编译。
想改编译选项(入口、别名、loader……),在 `ui/build.config.mjs` 里导出一个函数:收默认选项,返回改过的。
