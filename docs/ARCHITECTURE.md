# morphic 架构

一个可以完全修改自己的 Agent。出厂只有一个会压缩的对话和一个工具 shell,
其余的一切,由用户在对话里要、由它自己在自己身上长。

这份文档说明仓库里每个模块是什么、彼此怎么说话、发出去的是什么。

## 两块

| 目录 | 是什么 | 跑在哪 |
| --- | --- | --- |
| `client/` | 桌面客户端(Electron),唯一的产品 | 用户的电脑(macOS、Windows) |
| `site/` | morphic.iimos.ai:首页、下载、形态墙、谷歌登录、给 agent 调的接口 | Cloudflare,一个 Worker + D1 + R2,都叫 morphic |

两块各有自己的 `package.json`,互不依赖。它们之间唯一的约定是网站的接口,写在 `https://morphic.iimos.ai/agent.md` 里。

## 客户端里的模块

```text
client/
  shell/         桌面壳,Electron 主进程
    main.js        创建 launcher core,提供宿主能力(开窗口、重启、起不来时弹对话框);菜单栏图标:打开 / 退出
    surface.js     打开应用界面的窗口(按应用给的窗口偏好)、重载
    preload.cjs    Windows / Linux 无框窗口的三个窗口钮

  launcher/      不变层,纯 Node。Agent 改不到它
    core.js        一次启动的全过程:播种 / 升级 → 快照记账 → 拉起形态子进程 → 等报到 → 起不来就回滚、崩了就重拉
    child.js       形态子进程的入口:装好 globalThis.morphic(经 IPC 和 launcher 说话),再加载 workspace/main.js
    guardian.js    启动记账与回滚(连续两次没报到 → 回到 good,坏版本留成 crashed-* 分支)
    snapshot.js    纯 JS 的 git(isomorphic-git),用户机器上不需要装 git
    seed.js        出厂种子怎么进 workspace,升级怎么合
    control.js     控制接口(127.0.0.1 + 令牌):restart / reload / status
    build.js       界面编译(esbuild + React,随安装包带着)
    add.js         morphic add:从 esm.sh 装前端库
    cli.js         `morphic` 命令:agent 编译、重载、重启、快照、回滚自己用
    CONTRACT.md    写给 agent 的契约,每轮都在它的系统指令里

  app/           出厂种子 = Agent 能改的身体。纯 Node + 网页,不碰 Electron
    main.js        应用入口:起本地服务,morphic.ready({ url }) 报到
    server/        本地服务(127.0.0.1 + 令牌)、唯一的那个对话
      agent/         Agent 循环、唯一的工具 shell、上下文压缩、prompt.md
      ai/            模型请求(Responses 流式)
    ui/            React + TSX,morphic reload 时编译。一个对话

  build/  scripts/   图标、签名、打包、发版
```

**不变层和种子分开放**是整个设计的底线:Agent 能改的东西(`app/`)和负责兜底的东西(`launcher/`)不在一起,
所以它把自己改坏了,launcher 还能把它退回去。

## 启动:core 与宿主

`launcher/core.js` 不 import Electron。宿主(`shell/main.js`)告诉它怎么做这几件事:

| 宿主能力 | 做什么 |
| --- | --- |
| `whenReady()` | `app.whenReady()` |
| `openSurface(url, window)` | 按窗口偏好开窗口加载 url,加载完算界面活着 |
| `reloadSurfaces()` | 重载应用窗口 |
| `relaunch()` | `app.relaunch()` 后退出 |
| `fatal(message)` | 连稳定版本都起不来:弹对话框说明,给「退出」「打开数据目录」 |

**形态跑在子进程里**:launcher 用 Electron 自带的 Node(`ELECTRON_RUN_AS_NODE`)把 `launcher/child.js` 拉起成子进程,
它加载 workspace 的 `main.js`。形态卡死、崩溃、吃光内存都拖不垮 launcher 和窗口;报到之后崩了,launcher 把它重新拉起;
报到之前就死,按下面的兜底记账。形态和 launcher 之间只有一条 IPC 通道:报到、叫 launcher 做事(`morphic.call`)、收事件(`morphic.on`)。

**应用怎么报到**:workspace 根目录的 `main.js` 起服务后调用 `globalThis.morphic.ready({ url, window })`。
launcher 交给宿主打开这个 url,确认界面真的能加载,才记为启动成功。`window` 是桌面窗口的偏好
(大小、标题、开窗底色),应用换了风格可以跟着改。

**兜底只有一层**:每次启动前快照;同一版本连续两次没报到,回滚到 good(稳定跑过几分钟的版本);
good 本身也起不来,就不再硬起,弹对话框告诉用户。没有救援页,也没有第二个 agent。

## 对话

只有一个对话,永远不结束。

- **压缩**:每次请求模型前看上一次的用量,到上下文窗口的 70% 就把较早的部分写成交接摘要。原始条目一条不删,界面照样能往上翻。
- **重启接续**:agent 改了服务端要重启自己时,这一轮会被打断;新进程起来后自动接着跑完。
- **停下**:用户随时能停。没跑完的工具调用会补一条「用户停下了」的结果,对话不会因此卡住。

## 工具只有 shell

读文件、改文件、联网、给自己加东西,都在 shell 里做。`node` 和 `morphic` 两条命令在 PATH 里
(node 是 Electron 自带的那个,用户机器上不需要另装)。要别的工具,agent 按 AGENT.md 里写的方式给自己加。

电脑操作、浏览器操作不归 morphic,那是 agentic 的事。

## 分享:形态和 morphic.iimos.ai

一份形态 = 某个 morphic 的 workspace 里的全部代码文件(不含 `.git`、`.morphic/`、依赖、日志)。
用户数据在 `$MORPHIC_DATA`,天然不在里面。

客户端里没有分享的代码。agent 的提示词只写一句:用户要看、要换、要分享时,先 `curl https://morphic.iimos.ai/agent.md`。
那一页写着全部接口和现成的小脚本,agent 照着用 shell 调。改接口只改网站,不用发新客户端。

| 接口 | 要登录 | 作用 |
| --- | --- | --- |
| `GET /api/shapes?q=&sort=` | 否 | 列表、搜索 |
| `GET /api/shapes/<id>` | 否 | 详情、文件清单 |
| `GET /api/shapes/<id>/files` | 否 | 全部文件(文本给 content,二进制给 base64) |
| `POST /api/shapes` | 是 | 发布(JSON);网站再扫一遍密钥,有就拒绝 |
| `DELETE /api/shapes/<id>` | 是 | 删除自己发的 |

**登录**只用谷歌。agent 走设备授权(像电视登录):`POST /api/auth/device` 拿一个码 → 用户打开 `/device`,
用谷歌登录、核对码、点同意 → agent `POST /api/auth/token` 取到令牌,存在 `$MORPHIC_DATA/morphic-ai.json`。
会话、令牌、设备码在网站上都只存哈希。

**换上别人的形态**:agent 先 `morphic snapshot`,告诉用户要换进来什么,用户点头了再写文件、`morphic restart`。
换上的起不来,launcher 照常回滚;不喜欢,`morphic rollback` 回去。

## 发出去的东西

| 产物 | 组成 | 给谁 |
| --- | --- | --- |
| Mac 安装包(dmg) | client:shell + launcher + app(种子) | 用户 |
| Windows 安装包(exe) | 同上 | 用户 |
| morphic.iimos.ai | site | 官方部署,也可自部署 |
