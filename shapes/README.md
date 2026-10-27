# iimos 形态源码

这里是形态的唯一源码目录；每个子目录都是能独立作为 iimos workspace 启动的完整形态，不另建 Git 仓库。`client/app/` 是安装包使用的出厂种子，保留在客户端目录。

| 目录 | 形态 | 契约 |
| --- | --- | --- |
| `agentic/` | 对话列表与工具 | 1 |
| `worktop/` | 标签页和分屏工作台 | 2 |
| `ramify/` | 创意分支画布 | 1 |
| `messages/` | 信息风格对话 | 1 |
| `mindmap/` | 思维导图 | 1 |

开发时在 `client/` 中设置 `IIMOS_SEED=../shapes/<目录名>`，再用临时 `IIMOS_HOME` 启动。每个形态自己的 README 有构建和测试命令。运行中的用户 workspace 位于 iimos 数据目录，不是这里的第二份源码。

旧版独立 mindmap 项目保留在 `references/mindmap/`，供当前 mindmap 形态参考；它不是可直接换上的形态。`ramify-dsh` 是独立产品，留在 iimos 目录外。
