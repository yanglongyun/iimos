# 暮光之下

iimos 的地下城冒险形态。界面是地图、角色、行囊、冒险日志和行动区；不配置模型也能完整游玩固定冒险。

- `server/game.js`：房间、地图边、角色、战斗、真实掷骰、搜寻、任务与归档。游戏规则的唯一来源。
- `GET /api/game`：读取当前冒险；`POST /api/game`：传 `{ id, turn, action, target? }`，版本过期返回 409。
- `game` 模型工具：inspect 读取同一游戏状态，其余动作走同一引擎。传入最新 id 和 turn。不能通过旁路文件写入改变局势。
- `server/agent/runner.js`：game 与 shell 工具分发；Conversation 将数据根目录交给 Agent，状态不会放在 workspace。
- `server/conversation.js`：持久化主持人对话、压缩和重启接续。
- `ui/src/App.tsx`：地图、战斗按钮、药水、日志、主持人交谈和角色面板。按界面读取的回合发送动作，冲突时刷新。
- `ui/src/style.css`：深绿石室、黄铜细线、宋体日志；桌面首屏始终保留行动区，角色侧栏独立滚动。

任务路径：旧城门 → 回声长廊 → 守卫室 → 无声书库找钥匙；通过宝库或墓室到祭坛取圣物；回到旧城门后离开。战斗中只能攻击、防御、撤退或喝药水。
攻击由 D20 对敌人防御判定，伤害与敌人反击均真实掷骰。生命耗尽结束冒险。重开会把旧记录归档，不删除历史。

数据：`$IIMOS_DATA/dungeon/campaign.json`、`archives/<id>.json`、`conversation.json`。模型配置仍是 `$IIMOS_DATA/config.json`。
开发复用 `client/` 工具链，执行 `npm run build`、`npm run check`、`npm test`。测试覆盖完整通关、失败、回合冲突、归档与模型工具的一致性。
