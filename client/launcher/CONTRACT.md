# launcher 契约

你运行在 morphic 里。morphic 分两部分:

- **launcher**:安装包里那一小块,你改不了,也不需要改。它负责启动应用、记录版本、应用起不来时把它退回上一个能用的版本。
- **应用**:就是你脚下这个目录(workspace,shell 的默认工作目录)。界面、本地服务、
  agent 循环、工具、你自己的提示词 —— **全在这里,全都可以改**。

你跑在用户的电脑上(macOS 或 Windows)。launcher 开窗口加载你报到的地址;菜单栏图标只有「打开」和「退出」。
**应用是纯 Node,不要 import electron。**

出厂时应用只有一个对话,一个工具 shell。之后它长成什么样,由用户在对话里说了算:要什么,你就在这里把它做出来;
没要的,不要提前造。没有哪一块是「框架,别碰」。

## 你能用的命令

`node` 和 `morphic` 在 PATH 里(node 是 Electron 自带的那个,用户机器上不需要另装,也没有 npm)。

| 命令 | 什么时候用 |
| --- | --- |
| `morphic status` | 看当前版本、稳定版本(good)、没提交的改动 |
| `morphic snapshot "说明"` | **每改完一件事就记一笔。** 说明写给用户看,讲做了什么 |
| `morphic log` / `morphic diff [版本]` | 看历史、看改了什么 |
| `morphic add <包>[@版本]` | 装一个前端库(从 esm.sh 打成单文件放进 `ui/vendor/`,记在 `vendor.json`),之后照常 `import`。需要联网;React 不用装 |
| `morphic build` | 只编译界面:`ui/src`(React + TSX)→ `ui/dist`。编不过时 dist 不动,错误打出来 |
| `morphic reload` | 只改了 `ui/`:先编译界面,通过了才重载窗口,对话不中断;编不过窗口不动,看错误改 |
| `morphic restart` | 改了 `main.js`、`server/`:先编译界面,再整个应用重启,你这一轮也会被打断;出厂应用会在新代码起来后自动接着这一轮跑(见 AGENT.md「重启接续」)|
| `morphic rollback <版本\|good>` | 回到某个版本(当前样子会留成分支),然后重启 |
| `morphic upgrade` | 有新出厂版本、但应用被改过时,看怎么合并 |

## 改坏了怎么办

launcher 在每次启动前自动快照。重启后应用如果没在规定时间内报到(`globalThis.morphic.ready()`),
同一版本连续两次起不来,launcher 就把工作区回滚到 good,并把坏掉的版本留在 `crashed-*` 分支。
回滚发生后你会在下一轮看到通知,读 `.morphic/rollback.json` 和 `morphic status` 就知道是哪次改动出的事。
**被回滚了先告诉用户**,再决定是修好重来还是放弃那个改动。

稳定运行几分钟的版本会自动成为新的 good。所以大改动要分步:改一块 → reload/restart → 确认能用 → 再改下一块。

## 必须守住的四件事

1. `main.js` 是 launcher 加载的入口(纯 Node)。它起本地服务,然后调用 `globalThis.morphic?.ready({ url })`,
   url 是带令牌的界面地址(`http://127.0.0.1:端口/?token=…`)。launcher 打开这个地址、真的加载出来才算报到;
   不报到会被当成启动失败。
2. 用户数据不在 workspace 里,在 `MORPHIC_DATA` 指向的目录。回滚只回代码,不动数据 ——
   所以改数据格式要向前兼容,别让旧版本代码读不了新数据。
3. **模型配置固定放在 `$MORPHIC_DATA/config.json`**,至少含 `responsesUrl`、`apiKey`、`model` 三项
   (OpenAI Responses 协议)。别挪,也别改这三个字段的意思。
4. **`AGENT.md` 由你维护。** 它是写给下一次的你自己看的:现在的结构、各块在哪、做过的约定、踩过的坑。
   每次改了结构或加了功能,顺手更新它。你每一轮都会读到它,它写错了,下一次的你就会被带偏。

## globalThis.morphic

| 成员 | 用途 |
| --- | --- |
| `ready({ url, window? })` / `failed(err)` | 报到 / 自己知道起不来了。`window` 是桌面窗口的偏好:`{ width, height, minWidth, minHeight, title, background }`(background 是开窗时的底色,和界面底色一致就不闪)|
| `onShutdown(fn)` | 重启或退出前的收尾,`fn({ restarting })` |
| `restart()` / `reload()` | 同名命令 |

## 环境变量

`MORPHIC_WORKSPACE`(就是这里)· `MORPHIC_DATA`(用户数据)· `MORPHIC_SEED`(出厂版本的只读副本,想看原样时去那里找)·
`MORPHIC_BIN`(node/morphic 所在目录)· `MORPHIC_VERSION`(launcher 版本)· `MORPHIC_CONTRACT`(本文件)·
`MORPHIC_TOOLCHAIN`(launcher 带的 esbuild、react、react-dom 所在的 node_modules,界面编译时 import 'react' 就从这里找)

## 界面编译

`ui/src/main.tsx` 是入口,编到 `ui/dist/main.js` 和 `main.css`,`ui/index.html` 引用它们。
`ui/dist` 要跟着源码一起进快照 —— 回滚时直接拿到能跑的界面,不用重新编译。
想改编译选项(入口、别名、loader……),在 `ui/build.config.mjs` 里导出一个函数:收默认选项,返回改过的。
