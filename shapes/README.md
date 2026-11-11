# iimos 形态源码

这里是所有形态的唯一源码目录，按发布状态分为两组。每个形态都是能独立作为 iimos workspace 启动的完整源码，不另建 Git 仓库。

## 已上线：published/

以下七个形态已在 iimos.ai 发布。`published/terminal/` 同时是客户端安装包的出厂种子，开发启动、编译和打包直接使用该目录。

| 目录 | 形态 | 契约 |
| --- | --- | --- |
| `published/terminal/` | 终端 | 1 |
| `published/retro/` | 拟物终端 | 1 |
| `published/agentic/` | 对话列表与工具 | 1 |
| `published/messages/` | 信息风格对话 | 1 |
| `published/worktop/` | 标签页和分屏工作台 | 2 |
| `published/ramify/` | 创意分支画布 | 1 |
| `published/mindmap/` | 思维导图 | 1 |

## 开发中：development/

这些形态尚未发布。Windows 98 和 Mac OS 9 保留开发；地下城和电台先暂存源码。

| 目录 | 形态 | 契约 |
| --- | --- | --- |
| `development/win98/` | Windows 98 经典桌面 | 1 |
| `development/macos9/` | Mac OS 9 Platinum 桌面 | 1 |
| `development/dungeon/` | 地下城原型 | 1 |
| `development/radio/` | 电台原型 | 1 |

## 开发与发布

在 `client/` 中指定完整的种子路径，再使用独立的临时数据目录启动：

```sh
IIMOS_SEED=../shapes/published/agentic IIMOS_HOME=/tmp/iimos-agentic npm run app
IIMOS_SEED=../shapes/development/macos9 IIMOS_HOME=/tmp/iimos-macos9 npm run app
```

每个形态自己的 README 有构建和测试命令。网站发布的是源码快照；发布后将形态移入 `published/`，并一次更新所有路径引用。目录移动本身不会发布到网站。
运行中的用户 workspace 和用户数据位于 iimos 数据目录，不随源码分类移动。

`published/retro/` 从网站公开源码导入；所有形态之后都在本仓库维护。
旧版独立 mindmap 项目保留在 `references/mindmap/` 供开发参考，不是可直接换上的形态。`ramify-dsh` 是独立产品，留在 iimos 目录外。
