# launcher 契约

你运行在 iimos 里。iimos 分两部分:

- **launcher**:安装包里那一小块,你改不了,也不需要改。它负责启动应用、记录版本、应用起不来时把它救回来。
- **应用**:就是你脚下这个目录(workspace,bash 的默认工作目录)。界面、本地服务、
  agent 循环、工具、你自己的提示词 —— **全在这里,全都可以改**。

同一份应用可能跑在两种宿主上(`IIMOS_HOST`):

- `desktop`:用户的电脑。launcher 开窗口加载你报到的地址,菜单栏、开机自启、电脑操作、浏览器连接都在。
- `server`:一台服务器。没有窗口,用户用浏览器或手机(经中继)打开;没有电脑操作。

所以**应用是纯 Node,不要 import electron**。要窗口、通知、截屏、操作电脑,经 `globalThis.iimos` 找 launcher。

出厂时应用只有一个对话。之后它长成什么样,由用户在对话里说了算:要什么,你就在这里把它做出来;
没要的,不要提前造。没有哪一块是「框架,别碰」。

## 你能用的命令

`node` 和 `iimos` 在 PATH 里(桌面上 node 是 Electron 自带的那个,用户机器上不需要另装,也没有 npm)。

| 命令 | 什么时候用 |
| --- | --- |
| `iimos status` | 看当前版本、稳定版本(good)、没提交的改动 |
| `iimos snapshot "说明"` | **每改完一件事就记一笔。** 说明写给用户看,讲做了什么 |
| `iimos log` / `iimos diff [版本]` | 看历史、看改了什么 |
| `iimos add <包>[@版本]` | 装一个前端库(从 esm.sh 打成单文件放进 `ui/vendor/`,记在 `vendor.json`),之后照常 `import`。需要联网;React 不用装 |
| `iimos build` | 只编译界面:`ui/src`(React + TSX)→ `ui/dist`。编不过时 dist 不动,错误打出来 |
| `iimos reload` | 只改了 `ui/`:先编译界面,通过了才重载窗口,对话不中断;编不过窗口不动,看错误改 |
| `iimos restart` | 改了 `main.js`、`server/`、`agent/`:先编译界面,再整个应用重启,你这一轮也会被打断;出厂应用会在新代码起来后自动接着这一轮跑(见 AGENT.md「重启接续」)|
| `iimos rollback <版本\|good>` | 回到某个版本(当前样子会留成分支) |
| `iimos upgrade` | 有新出厂版本、但应用被改过时,看怎么合并 |
| `iimos pair [名字]` | 配对一台手机:打出二维码和链接,手机扫了就能远程用你(经中继,端到端加密)|
| `iimos devices` / `iimos revoke <id>` | 看配对过的设备、吊销一台 |
| `iimos remote [on [中继]\|off]` | 远程访问的开关和状态 |
| `iimos hands [list\|call <工具> '<json>']` | 看现在有哪些手、直接调一次(调试用)|
| `iimos share` / `iimos adopt <链接>` | 把现在的样子分享成一个「形态」、换上别人分享的形态 |

## 改坏了怎么办

launcher 在每次启动前自动快照。重启后应用如果没在规定时间内报到(`globalThis.iimos.ready()`),
同一版本连续两次起不来,launcher 就把工作区回滚到 good,并把坏掉的版本留在 `crashed-*` 分支。
回滚发生后你会在下一轮看到通知,读 `.iimos/rollback.json` 和 `iimos status` 就知道是哪次改动出的事。
**被回滚了先告诉用户**,再决定是修好重来还是放弃那个改动。

稳定运行几分钟的版本会自动成为新的 good。所以大改动要分步:改一块 → reload/restart → 确认能用 → 再改下一块。

用户随时可以按 ⌘⌥⇧R(Windows 上 Ctrl+Alt+Shift+R)、菜单栏「救援」或手机上的「救援页」打开救援,那里有一个不依赖应用的救援 agent。

## 必须守住的四件事

1. `main.js` 是 launcher 加载的入口(纯 Node)。它起本地服务,然后调用 `globalThis.iimos?.ready({ url })`,
   url 是带令牌的界面地址(`http://127.0.0.1:端口/?token=…`)。launcher 打开这个地址、真的加载出来才算报到;
   不报到会被当成启动失败。手机远程访问也是经这个地址进来的(令牌由 launcher 补上,手机拿不到)。
   接口除了认 `?token=`,还要认请求头 `x-iimos-token`。
2. 用户数据不在 workspace 里,在 `IIMOS_DATA` 指向的目录。回滚只回代码,不动数据 ——
   所以改数据格式要向前兼容,别让旧版本代码读不了新数据。
3. **模型配置固定放在 `$IIMOS_DATA/config.json`**,至少含 `responsesUrl`、`apiKey`、`model` 三项
   (OpenAI Responses 协议)。救援 agent 从这里读凭据;挪走了,应用坏掉时用户就没有救援对话可用。
4. **`AGENT.md` 由你维护。** 它是写给下一次的你自己看的:现在的结构、各块在哪、做过的约定、踩过的坑。
   每次改了结构或加了功能,顺手更新它。你每一轮都会读到它,它写错了,下一次的你就会被带偏。

## globalThis.iimos

| 成员 | 用途 |
| --- | --- |
| `ready({ url, window? })` / `failed(err)` | 报到 / 自己知道起不来了。`window` 是桌面窗口的偏好:`{ width, height, minWidth, minHeight, title, background }`(background 是开窗时的底色,和界面底色一致就不闪)|
| `onShutdown(fn)` | 重启或退出前的收尾,`fn({ restarting })` |
| `restart()` / `reload()` / `recovery()` | 同名命令 |
| `hands.list()` | 现在有哪些手:`[{ id, name, tools, remote }]`。本机的叫 local,借来的叫 remote:… |
| `hands.call(tool, args)` | 调一只手。`tool` 是 `computer`(看屏幕、点、打字)、`browser`(用户的 Chrome)、`notify`(本机通知)。没有能干这件事的手会抛错,错误信息直接告诉用户就行 |
| `remote.status()` / `remote.pair({ name })` | 远程访问状态 / 配对一台手机(返回 link 和二维码 svg)|
| `remote.push({ title })` | 让配对过、开了通知的手机收到「iimos 找你」(推送不带内容,中继看不到)|
| `capture()` | 截应用界面,返回 PNG Buffer;没有界面的宿主返回 null |
| `host` | `'desktop'` 或 `'server'` |

电脑操作要用户在菜单栏勾上「允许它操作这台电脑」,并给 iimos 屏幕录制和辅助功能权限;没勾时 `computer` 会报错说明怎么开。
用户按 ⌘⇧Esc 会立刻停下所有电脑操作。

## 环境变量

`IIMOS_WORKSPACE`(就是这里)· `IIMOS_DATA`(用户数据)· `IIMOS_SEED`(出厂版本的只读副本,想看原样时去那里找)·
`IIMOS_BIN`(node/iimos 所在目录)· `IIMOS_HOST`(desktop 或 server)· `IIMOS_VERSION`(launcher 版本)· `IIMOS_CONTRACT`(本文件)·
`IIMOS_TOOLCHAIN`(launcher 带的 esbuild、react、react-dom 所在的 node_modules,界面编译时 import 'react' 就从这里找)

## 界面编译

`ui/src/main.tsx` 是入口,编到 `ui/dist/main.js` 和 `main.css`,`ui/index.html` 引用它们。
`ui/dist` 要跟着源码一起进快照 —— 回滚时直接拿到能跑的界面,不用重新编译。
想改编译选项(入口、别名、loader……),在 `ui/build.config.mjs` 里导出一个函数:收默认选项,返回改过的。
