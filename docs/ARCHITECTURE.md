# iimos 架构

一个住在你自己机器上、一直醒着、会长出自己身体的个人 Agent。
你要它变它就变,它看出你需要也会长,手机上随时找得到它;别人长出来的形态,你可以一键长成同款。

这份文档说明仓库里每个模块是什么、彼此怎么说话、发出去的是什么。

## 一句话分工:大脑和手

- **大脑**:Agent、对话、可变的身体(界面、服务端、工具、提示词)、定时任务。住在哪台机器上都行。
- **手**:电脑操作、浏览器、系统通知。必须住在要被操作的那台电脑上。
- **管子**:中继。让手机、别的电脑、远处的手找到大脑。只转发密文,不存东西。

普通用户:大脑和手都在 Mac 客户端里。想 7×24 的用户:大脑挪到一台不关机的机器上,Mac 客户端退成一只手连回去。

## 模块

```text
launcher/    不变层核心,纯 Node。两种形态都用它。
  core.js        一次启动的全过程:播种/升级 → 快照记账 → 加载应用 → 等报到 → 回滚/救援
  guardian.js    启动记账与回滚(连续两次没报到 → 回到 good,坏版本留成 crashed-* 分支)
  snapshot.js    纯 JS 的 git(isomorphic-git)
  seed.js        出厂种子怎么进 workspace,升级怎么合
  control.js     控制接口(127.0.0.1 + 令牌):restart / reload / recovery / status / hands / remote
  recovery/      救援:一个不加载应用代码的网页 + 一个独立的小 Agent。本机窗口和手机都打开它
  remote.js      远程连接器:主动连中继,端到端加密,把手机的请求转给应用、把远处的手接进来
  hands-hub.js   手的总线:本机的手、远处连进来的手,对应用只露一个 call(tool, args)
  share.js       分享与长成同款:打包 workspace、上传、下载、导入
  serve.js       服务器形态的入口:守护进程,子进程退出码 75 就重启它(相当于桌面的 relaunch)
  cli.js         `iimos` 命令

shell/       桌面壳,Electron。只有桌面形态有。
  main.js        Electron 主进程:创建 launcher core,提供「窗口」「重启」「救援窗口」这些宿主能力
  surface.js     打开应用界面的窗口、截图、重载
  permissions.js 辅助功能、屏幕录制权限的检查与引导

app/         出厂种子 = Agent 能改的身体。纯 Node + 网页,不碰 Electron。
  main.js        应用入口:起本地服务,iimos.ready({ url }) 报到
  server/        本地服务(127.0.0.1 + 令牌)、对话、定时任务、看板
  ai/  agent/    模型请求、Agent 循环、工具(shell/read/write/edit/computer/browser/notify/schedule)
  ui/            React + TSX,iimos reload 时编译

hands/       手。跑在要被操作的那台电脑上。
  computer.js    截屏、点击、键盘、滚动、应用列表与切换(macOS)
  browser.js     浏览器插件的本地宿主:插件连进来,命令转过去
  notify.js      系统通知
  index.js       把上面这些包成 { tools, call(tool, args) };可以本机直接挂到 hub,也可以经中继连远处的大脑

extension/   Chrome 插件。连本机 hands 的浏览器宿主,在你登着账号的浏览器里看页面、点、填。

relay/       中继,Cloudflare Worker + Durable Object。每个 iimos 一个 DO。
             官方部署在 relay.iimos.ai,开源,可以自己部。

protocol/    共享约定,只有代码里的常量、编解码和文档:
  crypto.js      配对密钥、AES-GCM 帧(Node 和浏览器同一份,都用 WebCrypto)
  tunnel.js      隧道帧:http 请求/响应流、手的调用/结果、在线状态
  shape.js       分享包(形态)的格式
```

社区网站(形态广场)不在这个仓库,在 iimos-mono 的 `site/`,和官网一起。它和这里只通过 `protocol/shape.js` 说话。

## 启动:core 与宿主

`launcher/core.js` 不知道自己跑在 Electron 里还是服务器上。宿主(host)告诉它怎么做这几件事:

| 宿主能力 | 桌面(shell) | 服务器(serve) |
| --- | --- | --- |
| `whenReady()` | `app.whenReady()` | 立即 |
| `openSurface(url)` | 开窗口加载 url,加载完算界面活着 | GET url 返回 200 算界面活着 |
| `reloadSurfaces()` | 重载所有应用窗口 | 无 |
| `relaunch()` | `app.relaunch()` 后退出 | 以退出码 75 退出,守护进程重新拉起 |
| `showRecovery(url)` | 开救援窗口加载救援页 | 打日志;救援页照样能从手机打开 |
| `capture()` | 截应用窗口 | 无 |
| `hands` | 本机的手(电脑操作、浏览器、通知) | 无,等远处的手连进来 |

**应用怎么报到**:workspace 根目录的 `main.js` 起服务后调用 `globalThis.iimos.ready({ url })`。
launcher 交给宿主打开这个 url,确认界面真的能加载,才记为启动成功。
老版本的 `desktop/main.js`(直接用 Electron)在桌面形态下仍然能加载,升级时由 Agent 合并。

## 远程:中继与端到端加密

```text
手机浏览器 ──wss── relay.iimos.ai (DO: iimos 实例) ──wss── 你的 iimos(launcher/remote.js)
              密文                      只转发                       解密,转给 127.0.0.1 的应用
```

- 每个 iimos 有一个实例 id。launcher 主动连出去,机器不开端口。
- **配对**:`iimos pair` 生成一个设备 id 和 32 字节密钥,做成链接 `https://relay.iimos.ai/m/<实例>#<设备>.<密钥>`
  显示成二维码。密钥在 `#` 后面,浏览器不会发给服务器。设备列表在 `$IIMOS_DATA/devices.json`,删掉一条就吊销。
- **帧**:每一帧 AES-256-GCM 加密,带设备 id 和随机 IV。中继看到的只有「哪个连接发了多少字节」。
- **手机上看到的就是你的界面**:中继给手机一个外壳页,外壳页注册 Service Worker,把对 `/m/<实例>/app/` 的
  所有请求(包括 SSE 事件流)经加密隧道转给你的 iimos。应用的界面不需要知道自己在被远程访问。
- **救援也能远程**:隧道里 `/__recovery/` 开头的请求转给 launcher 的救援页,应用起不来时手机照样能修。
- **推送**:手机把浏览器的推送订阅交给 DO;iimos 想找你时让 DO 发一条**不带内容**的推送(「iimos 找你」),
  点开后内容走加密隧道取。所以推送服务商也看不到内容。
- **远处的手**:电脑上的 hands 以「手」的身份配对,连到同一个 DO,iimos 经隧道调用它。

## 手

应用看到的接口只有一个:

```js
const hands = globalThis.iimos.hands;
hands.list();                         // [{ id, name, tools: ['computer', 'browser', 'notify'] }]
await hands.call('computer', { action: 'screenshot' });
```

桌面形态里手就在本机进程里;服务器形态里要等一台电脑连进来。没有手时 call 返回明确的错误,Agent 照实告诉用户。

电脑操作需要 macOS 的「辅助功能」和「屏幕录制」授权,绑在签过名的 iimos.app 上,由 `shell/permissions.js`
引导用户打开。浏览器插件经本机 WebSocket(127.0.0.1 + 一次性配对码)连到 hands。

## 一直醒着、主动来找你

- 定时任务在应用的服务端(出厂自带),到点就开一轮对话,结果写进对话,需要时发通知和推送。
- 服务器形态是常驻进程;桌面形态下,`iimos` 可以设为开机自启、合盖不退出(仍受系统睡眠影响)。
- Agent 被鼓励第一次见面就主动提议建立连接(装插件、给权限、配对手机),并在 `$IIMOS_DATA/memory.md`
  记下对用户的观察。它可以自己长出新东西,改动已有的东西要用户点头。

## 分享:形态

一份形态 = workspace 某个版本的全部文件(不含 `.git`、`.iimos/`),外加 `shape.json`:
标题、一句话、「让它长成这样的那几句话」、作者、父形态。用户数据在 `$IIMOS_DATA`,天然不在里面。

- `iimos share`:检查(密钥模式、本机绝对路径、AGENT.md 里的私人内容)→ 打包 → 截图 → 上传到 iimos.ai
- `iimos adopt <形态>`:下载 → 列出将要换进来的文件 → 用户同意 → 快照当前样子 → 换身体 → 重启
- 谱系:`shape.json` 记着父形态,网站画成树

## 发出去的东西

| 产物 | 组成 | 给谁 |
| --- | --- | --- |
| Mac 安装包 | shell + launcher + app(种子)+ hands | 普通用户 |
| 服务器版 `npx iimos-server` / Docker | launcher + app(种子) | 想 7×24 的人 |
| Chrome 插件 | extension | 想让它用浏览器的人 |
| 中继 | relay | 官方部署一份,也可自部署 |
