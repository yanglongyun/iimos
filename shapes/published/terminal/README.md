# terminal

iimos 的出厂终端形态：黑底绿字，一个自动压缩的对话，一个 shell 工具。
界面、服务、工具和提示词都可以由 Agent 修改。

本目录是 terminal 的唯一源码，也是客户端安装包的出厂种子。开发启动、编译、测试和打包都直接使用这里的文件。

## 开发

需要 Node.js 22.5+。先在 `client/` 安装开发依赖：

```sh
cd client
npm install
IIMOS_HOME=/tmp/iimos-terminal npm run app
```

在本目录中：

```sh
npm run build    # 使用 client 的工具链编译 ui/src → ui/dist
npm test         # 假模型的端到端测试
npm start        # 不经 launcher 起本地服务，没有快照和回滚
```

在 `client/` 中运行 `npm run typecheck` 检查 terminal、retro 和 win98 的界面类型，`npm test` 运行 launcher 和这三个形态的测试。

入口是 `main.js`，服务在 `server/`，界面在 `ui/`。结构和运行约定见 [AGENT.md](AGENT.md)。
通过 launcher 运行时，用户数据保存在 `$IIMOS_DATA`；单独启动可设置同名环境变量，默认使用本目录的 `.data/`。
