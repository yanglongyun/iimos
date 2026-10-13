# iimos 架构

一个住在你自己电脑上、一直醒着、会长出自己身体的个人 Agent。
你要它变它就变,它看出你需要也会长;别人长出来的形态,你可以一键长成同款。

这份文档说明仓库里每个模块是什么、彼此怎么说话、发出去的是什么。

## 两块

| 目录 | 是什么 | 跑在哪 |
| --- | --- | --- |
| `client/` | 桌面客户端(Electron),唯一的产品 | 用户的电脑(macOS、Windows) |
| `site/` | iimos.ai:首页、发布、形态墙与接口 | Cloudflare,一个 Worker + D1 + R2,都叫 iimos |

两块各有自己的 `package.json`,互不依赖。唯一共用的是形态包格式 `client/launcher/shape.js`,网站直接引用它。

## 客户端里的模块

```text
client/
  shell/         桌面壳,Electron 主进程
    main.js        创建 launcher core,提供「窗口」「重启」「救援窗口」这些宿主能力;弹系统通知
    surface.js     打开应用界面的窗口(按应用给的窗口偏好)、截图、重载
                   菜单栏:开机自启、保持唤醒、救援;系统通知

  launcher/      不变层,纯 Node。Agent 改不到它
    core.js        一次启动的全过程:播种/升级 → 快照记账 → 加载应用 → 等报到 → 回滚/救援
    guardian.js    启动记账与回滚(连续两次没报到 → 回到 good,坏版本留成 crashed-* 分支)
    snapshot.js    纯 JS 的 git(isomorphic-git)
    seed.js        出厂种子怎么进 workspace,升级怎么合
    control.js     控制接口(127.0.0.1 + 令牌):restart / reload / recovery / status / notify
    recovery/      救援:一个不加载应用代码的网页 + 一个独立的小 Agent
    share.js       分享与换上:打包 workspace、扫密钥、截封面、上传;下载、预览、换上
    shape.js       形态包的格式(网站也用这一份)
    cli.js         `iimos` 命令

  app/           出厂种子 = Agent 能改的身体。纯 Node + 网页,不碰 Electron
    main.js        应用入口:起本地服务,iimos.ready({ url }) 报到
    server/        本地服务(127.0.0.1 + 令牌)、对话、定时任务(scheduler.js)、面板用的接口
      agent/         Agent 循环、工具(shell/read/write/edit/notify/schedule)、prompt.md
                     对话里的图存成文件,只有最近一张以原图给模型看(agent/images.js)
      ai/            模型请求
    ui/            React + TSX,iimos reload 时编译。一个对话 + 面板(定时任务)

  build/  scripts/   图标、签名、打包、发版
```

**不变层和种子分开放**是整个设计的底线:Agent 能改的东西(`app/`)和负责救它的东西(`launcher/`)不在一起,
所以它把自己改坏了,launcher 还能把它救回来。

## 启动:core 与宿主

`launcher/core.js` 不 import Electron。宿主(`shell/main.js`)告诉它怎么做这几件事:

| 宿主能力 | 做什么 |
| --- | --- |
| `whenReady()` | `app.whenReady()` |
| `openSurface(url, window)` | 按窗口偏好开窗口加载 url,加载完算界面活着 |
| `reloadSurfaces()` | 重载所有应用窗口 |
| `relaunch()` | `app.relaunch()` 后退出 |
| `showRecovery(url)` | 开救援窗口加载救援页 |
| `capture()` | 截应用窗口(分享形态时做封面) |
| `notify({ title, body })` | 弹系统通知(Electron Notification) |

**应用怎么报到**:workspace 根目录的 `main.js` 起服务后调用 `globalThis.iimos.ready({ url, window })`。
launcher 交给宿主打开这个 url,确认界面真的能加载,才记为启动成功。`window` 是桌面窗口的偏好
(大小、标题、开窗底色),应用换了风格可以跟着改。
老版本的 `desktop/main.js`(直接用 Electron)仍然能加载,升级时由 Agent 合并。

## 边界

电脑操作、浏览器操作不归 iimos,那是 agentic 的事。iimos 的 Agent 只改它自己(shell / read / write / edit),
用 notify 叫用户,用 schedule 按时醒来。要别的能力,由它在自己身上长。

## 一直醒着、主动来找你

- 定时任务在应用的服务端(`app/server/scheduler.js`,任务存 `$IIMOS_DATA/tasks.json`),Agent 用 `schedule` 工具增删改。
  到点了在唯一的那个对话里替用户开口跑一轮;对话正忙就等;电脑睡着错过的 12 小时内补跑一次。
- 通知:`notify` 工具弹本机系统通知。
- 关掉窗口不退出,菜单栏可以设开机自启、保持唤醒(仍受合盖睡眠影响)。
- 每轮的系统指令里有「此刻」(时间)和 `$IIMOS_DATA/memory.md`。
  提示词鼓励它记住用户、按时醒来、主动提议 —— 是指导,不是硬规矩;它可以自己长出新东西,改动已有的东西要用户点头。

## 分享:形态

一份形态 = workspace 当前版本里的全部文件(不含 `.git`、`.iimos/`、依赖、日志),打成 gzip 的 JSON,
带名字、「让它长成这样的话」、作者、出厂版本、谱系和封面。用户数据在 `$IIMOS_DATA`,天然不在里面。

- `iimos share "名字" --story "…"`:快照 → 打包 → 扫密钥(有就拒绝)→ 截界面当封面 → 发到 iimos.ai。
  删除令牌只存在本机 `$IIMOS_DATA/shares.json`。`--dry-run` 只看不发,`--out 文件` 只存本地。
- `iimos adopt <id | 链接 | 文件>`:下载 → 列出名字、来历、新增 / 改动 / 去掉多少文件 → 加 `--yes` 才换 →
  当前样子留成 `before-shape-*` 分支 → 换身体、写 `shape.json`(来源与谱系)→ 重启。换上的起不来,照常回滚到 good。
- 谱系:再分享时把 `shape.json` 里的来源接到谱系末尾;iimos.ai 的详情页列出「从它长出来的」。

网站收到形态时用同一份 `shape.js` 再检查一遍格式、再扫一遍密钥。

## 发出去的东西

| 产物 | 组成 | 给谁 |
| --- | --- | --- |
| Mac 安装包(dmg) | client:shell + launcher + app(种子) | 用户 |
| Windows 安装包(exe) | 同上 | 用户 |
| iimos.ai | site | 官方部署,也可自部署 |
