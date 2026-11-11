// 工具定义。出厂只有一个:shell。读文件、写文件、改文件、联网,都在 shell 里做。
// 别的工具等用户要了,由 agent 自己加:这里加定义,functions/ 加实现,runner.js 加分发。
const tools = [
  {
    type: "function",
    name: "game",
    description:
      "读取冒险状态或执行用户明确要求的冒险动作。真实掷骰、战斗与存档由游戏引擎处理，不自行编造。先 inspect 获取 id 和 turn，再执行动作。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "inspect",
            "move",
            "attack",
            "guard",
            "flee",
            "potion",
            "search",
            "rest",
            "interact",
          ],
        },
        id: { type: "string" },
        turn: { type: "integer" },
        target: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "shell",
    description:
      "在 workspace(应用自己的目录)里执行终端命令,返回合并输出与退出码。" +
      "node 和 iimos 两条命令可用;读写文件、改代码、联网(curl)都用它。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "终端命令" },
        workdir: { type: "string", description: "可选工作目录,相对 workspace" },
      },
      required: ["command"],
    },
  },
];

export default tools;
