# mindmap

iimos 的一个形态：一张会生长的思维导图。

左边和 agent 对话，右边是同一张图。写下一个中心主题，agent 先搭出几个方向；
之后选任意一支继续聊，它会加分支、改标题、补备注、移动或删除主题。所有修改直接落在画布上，
不是聊天里的文字建议。

- 中心主题 + 向两侧生长的主题树（参考 mindmap 应用的 SVG 画布引擎）
- 每个主题可以带一段备注
- 双击改标题，`Tab` 加子主题，`Enter` 加同级，拖到同级主题上下边缘排序、中央换父，`Alt+↑/↓` 排序，`Delete` 删除
- 画布/大纲双视图，大纲可复制 Markdown；工具栏可缩放、适应画布
- agent 工具：`add_topics` / `update_topic` / `move_topic` / `delete_topic` / `read_map` / `shell`
- 数据在 `$IIMOS_DATA/mindmap/`，模型配置沿用 `$IIMOS_DATA/config.json`

## 开发

```sh
npm install
npm run build      # 编译 ui/src → ui/dist
npm test           # 假模型的端到端测试
node main.js       # 不经过 launcher 单独起服务
```

在 iimos 里开发时，把本目录作为 workspace，用 `iimos reload` / `iimos restart`。
