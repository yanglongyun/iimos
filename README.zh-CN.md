# iimos

[English](README.md)

**一个可以完全修改自己的 Agent —— 住在你自己的机器上,一直醒着,手机上随时找得到它。** 出厂只有一个对话,其余的一切都在对话里长出来。

你要一个功能、一块界面、一种工作方式,它就把自己改成那样 —— 它能读自己的源码,
改自己的界面、服务、工具,甚至改自己的提示词。改完,它就变了。
所以世上没有两份一样的 iimos,每一份都是它主人的形状。

「把自己改成 Windows XP 桌面」—— 它把自己变成了这样(真实录屏,从出厂状态开始,中间快进):

![](docs/xp.gif)

- **你的机器,你的数据。** Agent、代码、数据都在你的 Mac(或你自己的服务器)上,没有账号。
- **一直醒着,揣在兜里。** 它自己按时跑定时任务,有要紧的事就叫你。扫一下二维码,手机上就是同一个界面 —— 不管它长成了什么样 ——
  经端到端加密的中继连过来,中继只看得到密文。
- **它有手。** 能看、能操作你的 Mac(截屏、点击、打字 —— 你在菜单栏勾上授权之后),能用你自己的 Chrome(装个小插件),能给你发通知。
- **形态能分享。** `iimos share` 把你的 iimos 长成的样子发到 [shapes.iimos.ai](https://shapes.iimos.ai);
  `iimos adopt <id>` 换成别人的样子,原来的留成分支,随时换回来。
- **模型用你自己的。** 任何兼容 OpenAI Responses 协议的服务:填地址、API Key、模型名就行。
- **改坏了能救回来。** 每次启动前自动快照;起不来就回滚到上一个好版本。还有一个不加载应用任何代码的救援页,电脑上、手机上都能打开。

## 试一试

打开后,在提示符里直接说:

```text
右边加一个待办列表
换成拟物风格,老式仪器面板那种
每天早上 8 点给我一份简短的科技早报
每小时用 Chrome 看一眼我的邮箱,有需要我处理的再告诉我
```

它会改自己的代码、重载窗口,然后告诉你多了什么、怎么用。

## 安装

**Mac(Apple 芯片):** 从 [Releases](https://github.com/yanglongyun/iimos/releases) 下载 dmg。
第一次打开时在对话里填模型配置(服务地址、API Key、模型名、上下文窗口大小)。
关掉窗口它还在菜单栏醒着。右上角 ≡ 打开面板:配对手机、看定时任务、看它有哪些手。

**服务器(7×24):** 没有窗口的大脑,放在一台不关机的机器上。第一次启动会在终端打出二维码,手机扫了就能打开界面、配模型。

```bash
docker build -t iimos .
docker run -d --name iimos --restart unless-stopped -v iimos:/data iimos
docker logs iimos
```

不用 Docker:`npm install && npm run serve`。服务器上没有屏幕和浏览器;想借你 Mac 的手,
服务器上 `iimos pair --hands`,Mac 上 `iimos hands link <链接>`。

**Chrome 插件(可选):** `npm run build:extension`,在 Chrome 里「加载已解压的扩展程序」选 `extension/dist/iimos-extension`,
填上 agent 给你的配对码。

API Key 只存在本机 `config.json`(权限 600),只发往你填的那个地址。

## 它是怎么做到的

```text
launcher/   安装包里唯一不变的部分。找到 workspace → 首次播种 / 升级 → 启动记账 → 加载 app
            启动前快照;同一版本连续两次没报到就回滚,坏版本留成 crashed-* 分支
            纯 Node,桌面和服务器共用。`iimos` 命令:status / snapshot / log / diff / rollback / reload /
            restart / add / pair / hands / share / adopt
            救援页:不加载 app 的任何代码,带回滚、恢复出厂和一个独立的救援 agent
            remote.js 主动连中继(不开端口),把手机的请求经加密隧道转给应用

shell/      Mac 客户端(Electron):窗口、菜单栏、快捷键、本机的手
hands/      电脑操作(一个 Swift 小程序:ScreenCaptureKit、CGEvent、辅助功能树)、浏览器插件的本地宿主、通知;
            可以借给远处的大脑
extension/  Chrome 插件
relay/      中继:Cloudflare Worker + Durable Object,部署在 relay.iimos.ai。只转发它看不懂的 AES-256-GCM 帧;
            给手机一个外壳页,外壳页的 Service Worker 把应用界面经隧道接进来。可以自己部署
community/  形态社区 shapes.iimos.ai:Cloudflare Worker + D1 + R2
protocol/   共用的格式:配对密钥与加密帧、隧道、形态包

app/        出厂的应用(种子)。首次打开时拷进 <数据目录>/workspace/(一个 git 仓库),
            之后 agent 改的都是那一份。出厂是一个对话加一个小面板:
  main.js   起本地服务 → 带着地址向 launcher 报到;纯 Node,不碰 Electron
  server/   本地服务:只听 127.0.0.1,接口要令牌;对话、事件流、定时任务
  ai/       模型请求(Responses 流式,失败自动重试)
  agent/    agent 循环;工具 shell / read / write / edit / computer / browser / notify / schedule;
            上下文到 70% 自动压缩;prompt.md 是它的基础提示词
  ui/       界面:React + TSX,改完 `iimos reload` 由 launcher 带的 esbuild 编译,编不过就不换
  AGENT.md  agent 自己维护的说明,写给下一次的它自己
```

更多见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

app 唯一要守的契约(详见 [launcher/CONTRACT.md](launcher/CONTRACT.md)):起来后向 launcher 报到;
用户数据放 `$IIMOS_DATA`,不放 workspace。其余全都可以改。

数据目录(macOS):`~/Library/Application Support/ai.iimos.desktop/`
—— `workspace/`(应用代码,git 仓库)· `data/`(对话、模型配置、定时任务、记忆、配对的设备,回滚不动它)· `launcher/`(账本、日志)。

救援:⌘⌥⇧R(Windows/Linux:Ctrl+Alt+Shift+R)、菜单栏、`--recovery` 启动参数,或手机上的「救援页」。停下所有电脑操作:⌘⇧Esc。

## 从源码跑

需要 Node 22.5+。

```bash
npm install
npm run app
```

用一个临时目录,不碰日常数据:

```bash
IIMOS_HOME=/tmp/iimos-dev npm run app
```

改了仓库里的 `app/` 想让开发用的 workspace 跟上:删掉 `<IIMOS_HOME>/workspace` 重新播种,
或者把 `app/package.json` 的 version 加一,下次启动按升级处理。

```bash
npm test                # launcher 的播种 / 回滚 / 升级、app 的端到端(假模型)、形态格式
npm run test:relay      # 隧道端到端,先在 relay/ 里 npx vite dev --port 8799
npm run serve           # 服务器形态,前台跑
npm run build:hands     # 编译电脑操作的小程序(macOS)
npm run build:app       # 打包,未签名,自己用
npm run ship:mac        # 签名 + 公证 + 验证
```

## 许可

[MIT](LICENSE)
