# iimos

住在你电脑里的 Agent。**出厂只有一个对话,其余的一切都在对话里长出来** ——
你要一个功能、一块界面、一种工作方式,它就把自己改成那样。

Agent、文件和数据全部在本机,没有账号、没有云端。模型用你自己的:
任何兼容 OpenAI Responses 协议的服务地址 + API Key + 模型名,第一次打开时在对话里填。

## launcher 与 app

```text
launcher/         安装包里唯一不变的部分,进 asar。只做四件事:
  main.js         找到 workspace → 首次播种 / 升级 → 启动记账 → 加载 app 的 desktop/main.js
  guardian.js     启动前快照;同一版本连续两次没报到 → 回滚到 good,坏版本留成 crashed-* 分支
  snapshot.js     纯 JS 的 git(isomorphic-git),用户机器上不需要装 git
  seed.js         出厂 app 怎么进 workspace;新版本来了,没改过就直接换,改过就等 agent 合并
  cli.js          `iimos` 命令:status / snapshot / log / diff / rollback / reload / restart / upgrade
  shims.js        给 agent 的 `node` 和 `iimos` 垫片(Electron 自己就是 Node)
  recovery/       救援窗口:不加载 app 的任何代码,带回滚、恢复出厂和一个独立的救援 agent
  CONTRACT.md     launcher 对 agent 的契约,每轮注入提示词

app/              出厂的应用本身(seed)。首次打开时拷进 <数据目录>/workspace/(一个 git 仓库),
                  之后 agent 改的都是那一份。出厂只有一个对话:
  desktop/main.js 起本地服务 → 开窗口 → 向 launcher 报到 globalThis.iimos.ready()
  server/         本地服务:托管 ui/、对话接口、事件流(只听 127.0.0.1,接口要令牌)
  ai/             模型请求(Responses 流式,失败自动重试)
  agent/          agent 循环(九种事件)、压缩;工具 shell / read / write / edit;prompt.md 是它的基础提示词
  ui/             界面:React + TSX,源码在 ui/src,iimos reload 时由 launcher 带的 esbuild 编到 ui/dist
  AGENT.md        agent 自己维护的说明,写给下一次的它自己
  test/           app 的测试,不进 workspace
```

app 唯一要守的(详见 `launcher/CONTRACT.md`):
`desktop/main.js` 起来后调 `globalThis.iimos?.ready()`;用户数据放 `$IIMOS_DATA`,不放 workspace;
模型配置固定在 `$IIMOS_DATA/config.json`(救援 agent 从这里读凭据)。其余全都可以改。

数据目录(macOS):`~/Library/Application Support/ai.iimos.desktop/`
—— `workspace/`(应用代码,git 仓库)· `data/`(对话、模型配置,回滚不动它)· `launcher/`(账本、日志、垫片)。

救援窗口:⌘⌥⇧R(Windows/Linux:Ctrl+Alt+Shift+R)、`--recovery` 启动参数,或应用在稳定版本上也起不来时自动打开。

## 跑起来

```bash
npm install
npm run app             # 经 launcher 启动:仓库里的 app/ 就是 seed
npm run app:direct      # 不经 launcher,直接跑 app/desktop/main.js(没有快照和回滚)
```

用一个临时目录,不碰日常数据:

```bash
IIMOS_HOME=/tmp/iimos-dev npm run app
```

改了仓库里的 app/ 想让开发用的 workspace 跟上:删掉 `<IIMOS_HOME>/workspace` 重新播种,
或者把 app/package.json 的 version 加一,下次启动按升级处理。

## 测试

```bash
npm test                # launcher 的播种 / 回滚 / 升级 + app 的端到端(假模型)
```

## 打包

```bash
npm run build:app       # 未签名,自己用
npm run ship:mac        # 签名 + 公证 + 验证
```

安装包 = `launcher/`(asar)+ `app/`(extraResources,作为 seed)。
