# iimos 电台

iimos 的主题 RSS 与语音简报形态。木壳播放器、调谐刻度、频道预设与节目单。

- `server/radio.js`：固定四个来源、RSS 解析、15 分钟缓存、失败时明确标注缓存、收藏。
- `GET /api/stations`：频道；`GET /api/episodes?station=<id>&refresh=1`：条目；`GET/POST /api/library`：收藏读写。
- 来源：Hacker News、NASA、少数派、Aeon。URL 固定，不接受任意来源地址。读取限制 2MB、12 秒，所有链接只接受 HTTP/HTTPS。
- `ui/src/App.tsx`：频道切换、调频滑杆、真实节目列表、浏览器语音播放/暂停/继续、语速/音量、收藏与中文简报。
- 模型简报使用当前 RSS 材料，消息头 `简报频道：<id>` 关联频道。界面从持久化对话中导出各频道最近一次简报，不保存重复摘要状态。
- 语音使用 SpeechSynthesis；开始动作才发声，切换条目/频道或离开页面会取消旧语音。按当前条目单篇播放，不伪造时间进度、音频或新闻。
- `server/conversation.js` 与 `server/agent/`：原有 Agent、shell、Responses、自动压缩和重启接续。用户可以继续要求验证来源或修改电台源码。

数据：`$IIMOS_DATA/radio/feeds/<station>.json`、`library.json`、`conversation.json`。模型配置仍在 `$IIMOS_DATA/config.json`。
收藏保留条目的标题、来源、链接和 RSS 摘要，便于之后读取。缓存过期不是数据迁移；只读当前结构，不添加旧格式兼容。

在 `client/` 安装依赖后，本目录运行 `npm run build`、`npm run check`、`npm test`。测试包含来源解析、脚本/链接处理、缓存与断网状态、收藏持久化和 Agent 链路。
