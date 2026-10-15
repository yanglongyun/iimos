# iimos

[English](README.md)

**一个可以完全修改自己的 Agent。** 出厂只有一个对话和一个工具:shell。界面、服务、工具,甚至它自己的提示词,都是它自己的源码,它都能改。你要什么,它就把自己改成什么,而不是另外交给你一个东西。

**「把自己改成 Windows XP 桌面」** —— 真实录屏,从出厂状态开始,中间快进:

![](docs/xp.gif)

- **你的电脑,你的数据。** Agent、代码、数据都在你自己的电脑上。API Key 只发往你填的那个地址。
- **一个对话,一个 shell。** 出厂就这么多。对话会自动压缩,永远聊不满;别的能力,你要了它再给自己长。
- **改坏了能退回来。** 每次启动前自动快照;新代码起不来,就退回上一个好版本,坏掉的那版留成分支。
- **形态能分享。** 跟它说「把你现在的样子分享到 iimos.ai」或者「换成 iimos.ai 上的形态 `<id>`」。它会读 [iimos.ai/agent.md](https://iimos.ai/agent.md),用 shell 调网站的接口。
- **模型用你自己的。** 任何兼容 OpenAI Responses 协议的服务:填地址、API Key、模型名就行。

## 从出厂状态开始,它做了这些

都是真实录屏,没有手动改过。中间快进,重载的那一下是实时的。上面那段:它改了自己的 React 和 CSS,编译、重载,对话变成了 XP 桌面上的一个窗口。

**「变成一个加密货币行情台,要真实数据」** 它本来完全上不了网。它给自己写了拉 OKX 行情的代码,每分钟刷新一次,还能设价格提醒。

![](docs/crypto.gif)

**「从现在起你是地下城主」** 它改了自己的提示词。界面变成了带选项按钮的文字冒险,每一步都真的掷骰子。

![](docs/game.gif)

**「在你自己的 main.js 第一行写 `throw new Error()`,然后重启」** 它崩了。launcher 几秒内把它退回上一个好快照;它回来后写了一份事故报告,又发现回滚多退了一步,自己从分支里把那部分工作找了回来。

![](docs/recover.png)

## 试一试

打开后,在提示符里直接说:

```text
右边加一个待办列表
换成拟物风格,老式仪器面板那种
给我做一个记账本
去 iimos.ai 看看别人的 iimos 都长成了什么样
```

它会改自己的代码、重载窗口,然后告诉你多了什么、怎么用。你用什么语言跟它说话,它就用什么语言回答。

## 安装

**Mac(Apple 芯片):** 从 [iimos.ai](https://iimos.ai) 或 [Releases](https://github.com/yanglongyun/iimos/releases) 下载 dmg。
第一次打开时在对话里填模型配置:服务地址、API Key、模型名、上下文窗口大小。服务地址填完整的 Responses 端点,通常以 `/responses` 结尾,比如 `https://api.deepseek.com/v1/responses`。
关掉窗口它还在菜单栏;菜单只有两项:打开、退出。

**Windows(x64):** 从 [Releases](https://github.com/yanglongyun/iimos/releases) 下载 exe 安装包。还没有代码签名,第一次运行时 SmartScreen 会拦一下,点「更多信息 → 仍要运行」。

API Key 只存在本机的 `config.json`(权限 600)。模型越强效果越好;上面这些用的都是 DeepSeek V4 Flash。

## 仓库里有什么

```text
client/       桌面客户端(Electron)
  shell/        Electron 主进程:窗口,和菜单栏图标(打开 / 退出)
  launcher/     安装包里不变的那一块。找到 workspace → 首次播种 / 升级 → 快照 → 加载应用。
                同一版本连续两次起不来,就退回上一个好版本(坏掉的那版留成 crashed-* 分支);
                连好版本都起不来,弹一个对话框说明。
                agent 用的 `iimos` 命令:status / snapshot / log / diff / rollback / add / build / reload / restart / upgrade
  app/          出厂的应用(种子)。首次打开时拷进 <数据目录>/workspace/(一个 git 仓库),之后 agent 改的都是那一份。
    main.js       起本地服务 → 带着地址向 launcher 报到;纯 Node,不碰 Electron
    server/       本地服务:只听 127.0.0.1,接口要令牌;对话、事件流
      agent/        agent 循环;一个工具 shell;上下文到 70% 自动压缩;prompt.md 是它的基础提示词
      ai/           模型请求(Responses 流式,失败自动重试)
    ui/           界面:React + TSX,改完 `iimos reload` 由 launcher 带的 esbuild 编译,编不过就不换
    AGENT.md      agent 自己维护的说明,写给下一次的它自己
site/         iimos.ai:首页、下载、形态墙、谷歌登录,和给 agent 调的接口(说明在 /agent.md)。
              一个 Cloudflare Worker + D1 + R2。
```

更多见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

应用唯一要守的契约(详见 [client/launcher/CONTRACT.md](client/launcher/CONTRACT.md)):起来后向 launcher 报到;用户数据放 `$IIMOS_DATA`,不放 workspace。其余全都可以改。

数据目录(macOS):`~/Library/Application Support/ai.iimos.desktop/`
—— `workspace/`(应用代码,git 仓库)· `data/`(对话、模型配置,回滚不动它)· `launcher/`(账本、日志)。

## 从源码跑

需要 Node 22.5+。Windows 上还需要 Git Bash(常见位置会自动找到,也可以用 `IIMOS_BASH` 指定;找不到时 shell 工具退回 cmd.exe)。

```bash
cd client
npm install
npm run app
```

用一个临时目录,不碰日常数据:

```bash
IIMOS_HOME=/tmp/iimos-dev npm run app
```

在 `client/` 里:

```bash
npm test                # launcher 的播种 / 回滚 / 升级、app 的端到端(假模型)
npm run build:app       # 打包,未签名,自己用
npm run ship:mac        # 签名 + 公证 + 验证
npm run release:win     # Windows 安装包(在 Windows 上跑)
```

网站在 `site/`(`npm run dev` / `npm run deploy`;先把 `cloudflare.config.example.ts` 复制成 `cloudflare.config.ts`)。

## 许可

[MIT](LICENSE)
