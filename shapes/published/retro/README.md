# retro

iimos 的拟物终端形态：米色仪器机箱、琥珀色 CRT 屏、连接指示灯和红色停止按钮。
功能与 terminal 一致：一个自动压缩的对话，一个 shell 工具。

源码从 [网站公开的 retro 形态](https://iimos.ai/s/retro) 导入，之后在本目录维护。

## 开发

需要 Node.js 22.5+。先在 `client/` 安装开发依赖，再指定本目录作为种子：

```sh
cd client
npm install
IIMOS_SEED=../shapes/published/retro IIMOS_HOME=/tmp/iimos-retro npm run app
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
