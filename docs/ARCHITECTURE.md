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
  share.js       分享与换上:打包 workspace、扫密钥、截封面、上传;下载、预览、换上
  serve.js       服务器形态的入口:守护进程,子进程退出码 75 就重启它(相当于桌面的 relaunch)
  cli.js         `iimos` 命令

shell/       桌面壳,Electron。只有桌面形态有。
  main.js        Electron 主进程:创建 launcher core,提供「窗口」「重启」「救援窗口」这些宿主能力
  surface.js     打开应用界面的窗口(按应用给的窗口偏好)、截图、重载
                 菜单栏:开机自启、保持唤醒、「允许它操作这台电脑」、停下所有电脑操作

app/         出厂种子 = Agent 能改的身体。纯 Node + 网页,不碰 Electron。
  main.js        应用入口:起本地服务,iimos.ready({ url }) 报到
  server/        本地服务(127.0.0.1 + 令牌)、对话、定时任务(scheduler.js)、面板用的接口
  ai/  agent/    模型请求、Agent 循环、工具(shell/read/write/edit/computer/browser/notify/schedule)
                 截图存成文件,只有最近一张以原图给模型看(agent/images.js)
  ui/            React + TSX,iimos reload 时编译。一个对话 + 面板(定时任务、手、配对手机)

hands/       手。跑在要被操作的那台电脑上。
  computer/      Swift 小程序源码(ScreenCaptureKit 截屏、CGEvent 键鼠、辅助功能树),build.js 编译
  computer.js    跟小程序说话(JSON 行协议);没勾「允许它操作这台电脑」时一律拒绝
  browser.js     浏览器插件的本地宿主(127.0.0.1:47231):插件连进来,命令转过去
  index.js       把电脑、浏览器、通知包成一只手 { tools, call(tool, args) },挂到 hub
  link.js        把这只手经中继借给远处的 iimos

extension/   Chrome 插件。连本机 hands 的浏览器宿主,在你登着账号的浏览器里看页面、点、填。

relay/       中继,Cloudflare Worker + Durable Object。每个 iimos 一个 DO。
             官方部署在 relay.iimos.ai,开源,可以自己部。test/ 是端到端测试(launcher ↔ 中继 ↔ 脚本扮演的手机)

community/   形态社区,Cloudflare Worker + D1 + R2。部署在 shapes.iimos.ai。
             形态墙、详情页、发布 / 下载 / 删除接口;页面在 Worker 里直接拼 HTML

protocol/    共享约定,只有代码里的常量、编解码和文档:
  crypto.js      配对密钥、AES-GCM 帧(Node 和浏览器同一份,都用 WebCrypto)
  tunnel.js      隧道帧:http 请求/响应流、手的调用/结果、在线状态
  shape.js       分享包(形态)的格式
```

社区站和 launcher 用同一份 `protocol/shape.js` 打包、检查形态。官网(iimos-mono 的 `site/`)只放入口链接。

## 启动:core 与宿主

`launcher/core.js` 不知道自己跑在 Electron 里还是服务器上。宿主(host)告诉它怎么做这几件事:

| 宿主能力 | 桌面(shell) | 服务器(serve) |
| --- | --- | --- |
| `whenReady()` | `app.whenReady()` | 立即 |
| `openSurface(url, window)` | 按窗口偏好开窗口加载 url,加载完算界面活着 | GET url 返回 200 算界面活着 |
| `reloadSurfaces()` | 重载所有应用窗口 | 无 |
| `relaunch()` | `app.relaunch()` 后退出 | 以退出码 75 退出,守护进程重新拉起 |
| `showRecovery(url)` | 开救援窗口加载救援页 | 打日志;救援页照样能从手机打开 |
| `capture()` | 截应用窗口 | 无 |
| `hands` | 本机的手(电脑操作、浏览器、通知) | 无,等远处的手连进来 |

**应用怎么报到**:workspace 根目录的 `main.js` 起服务后调用 `globalThis.iimos.ready({ url, window })`。
launcher 交给宿主打开这个 url,确认界面真的能加载,才记为启动成功。`window` 是桌面窗口的偏好
(大小、标题、开窗底色),应用换了风格可以跟着改;服务器上忽略。
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

电脑操作要两道门:用户在菜单栏勾上「允许它操作这台电脑」(存在 `$IIMOS_DATA/hands.json`),
以及 macOS 的「辅助功能」和「屏幕录制」授权(绑在签过名的 iimos.app 上)。⌘⇧Esc 随时停下所有电脑操作。
浏览器插件经本机 WebSocket(127.0.0.1 + 5 分钟有效的一次性配对码,之后是长期令牌,本机只存哈希)连到 hands,
只能动用户共享给 iimos 的标签页和 iimos 自己开的标签页。

把手借给服务器:服务器上 `iimos pair --hands`,电脑上 `iimos hands link <链接>`(存在 `$IIMOS_DATA/hands-link.json`,开机自动连)。

## 一直醒着、主动来找你

- 定时任务在应用的服务端(`app/server/scheduler.js`,任务存 `$IIMOS_DATA/tasks.json`),Agent 用 `schedule` 工具增删改。
  到点了在唯一的那个对话里替用户开口跑一轮;对话正忙就等;电脑睡着错过的 12 小时内补跑一次。
- 通知:`notify` 工具弹本机通知,同时让中继给开了通知的手机发一条不带内容的推送。
- 服务器形态是常驻进程;桌面形态关掉窗口不退出,菜单栏可以设开机自启、保持唤醒(仍受合盖睡眠影响)。
- 每轮的系统指令里有「此刻」(时间、跑在哪、有哪些手、手机连没连)和 `$IIMOS_DATA/memory.md`。
  提示词鼓励它记住用户、按时醒来、主动提议 —— 是指导,不是硬规矩;它可以自己长出新东西,改动已有的东西要用户点头。

## 分享:形态

一份形态 = workspace 当前版本里的全部文件(不含 `.git`、`.iimos/`、依赖、日志),打成 gzip 的 JSON,
带名字、「让它长成这样的话」、作者、出厂版本、谱系和封面。用户数据在 `$IIMOS_DATA`,天然不在里面。

- `iimos share "名字" --story "…"`:快照 → 打包 → 扫密钥(有就拒绝)→ 截界面当封面 → 发到 shapes.iimos.ai。
  删除令牌只存在本机 `$IIMOS_DATA/shares.json`。`--dry-run` 只看不发,`--out 文件` 只存本地。
- `iimos adopt <id | 链接 | 文件>`:下载 → 列出名字、来历、新增 / 改动 / 去掉多少文件 → 加 `--yes` 才换 →
  当前样子留成 `before-shape-*` 分支 → 换身体、写 `shape.json`(来源与谱系)→ 重启。换上的起不来,照常回滚到 good。
- 谱系:再分享时把 `shape.json` 里的来源接到谱系末尾;社区站的详情页列出「从它长出来的」。

## 发出去的东西

| 产物 | 组成 | 给谁 |
| --- | --- | --- |
| Mac 安装包 | shell + launcher + app(种子)+ hands | 普通用户 |
| 服务器版 `npm run serve` / Docker | launcher + app(种子) | 想 7×24 的人 |
| Chrome 插件 | extension | 想让它用浏览器的人 |
| 中继 | relay | 官方部署在 relay.iimos.ai,也可自部署 |
| 形态社区 | community | 官方部署在 shapes.iimos.ai,也可自部署 |
