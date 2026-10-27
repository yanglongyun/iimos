# ramify

[iimos](https://iimos.ai) 的一个形态:**整个窗口就是一块创意画布**。

左边是和 agent 的对话,中间是一棵作品树,右边预览。写一句需求、选好出几版,agent 一次生成 N 个方向不同的方案(网页、文档、SVG),
每个方案是树上一个能预览的节点;选中哪一个再接着说,那句话就带着它作为上下文;点它的「发散」直接从那个节点继续长分支 —— 旧方案永远留在树上。

换上它:对自己的 iimos 说「换成 iimos.ai 上的形态 ramify」,或者在 [iimos.ai/s/ramify](https://iimos.ai/s/ramify) 看它。

## 它长什么样

- 首屏一个输入框 + 方案数量(1–6)。提交后进入项目页,这句话成为对话的第一条。
- 项目页三栏:对话 | 画布 | 预览,分隔条可拖。对话里能看到 agent 的回复和每一次工具调用(写节点、建占位),随时停下;
  每个项目一条对话,存在本地,重开能看到历史。
- 画布是一棵横向的树:根是需求,下面是方案卡片(缩略图实时渲染);从任一方案分叉出的新一轮挂在它下面。
- 点卡片在右侧完整预览(能跑脚本),能看源码、复制、在新窗口打开;选中的节点会作为下一句话的上下文。
- 首页列出之前长过的画布。

## 它怎么工作

- 每个项目一条对话、一个 agent 循环(复用 iimos 出厂应用的模型请求、压缩和工具循环),带四个工具:
  `add_nodes`(在节点下建一批占位)、`write_node`(写入 / 更新一个节点)、`read_tree`(读整棵树)、`shell`。
- 事件推送是一条 SSE(agent 的九种事件 + 节点变化),操作全走 HTTP。
- 树用 `node:sqlite` 存在 `$IIMOS_DATA/ramify/ramify.db`;模型配置走 iimos 契约规定的 `$IIMOS_DATA/config.json`
  (`responsesUrl` / `apiKey` / `model`,OpenAI Responses 协议,所有形态共用)。
- 界面是 React + TSX,由 launcher 的 `iimos build`(esbuild)编译;第三方库用 `iimos add <包>` 装进 `ui/vendor/`(目前只有 marked)。
- 给 agent 自己看的说明在 [AGENT.md](AGENT.md)。

## 开发

```sh
npm install      # 只为本地编译界面和跑测试;用户机器上不需要
npm run build    # ui/src → ui/dist(产物进 git)
npm test         # node --test,假模型跑完整个流程
node main.js     # 不经 launcher 单独跑:数据放 IIMOS_DATA 或 ./.data,地址打在终端里
```

在 iimos 仓库里用 launcher 起它:

```sh
cd iimos/client && IIMOS_SEED=../shapes/ramify IIMOS_HOME=/tmp/ramify-dev npm run app
```

需要 Node 22.5+(`node:sqlite`)。

## 来历

从独立网页版 ramify(Skill + 本地画布运行时)移植而来:画布布局、节点卡片、暖纸视觉保留,把「递交给宿主 agent」
换成了 iimos 自己的 agent 循环,作品从文件改成直接存进 SQLite。

## 许可证

[MIT](LICENSE)
