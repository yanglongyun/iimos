import type { MessageItem, ReasoningItem, FunctionCallItem, FunctionOutputItem } from "./thread";

// 推送的就是 Agent 的九种事件，聊天层只补 session_id；完整 item 已存库，带数据库 id 和 created_at。
type Saved = { id: number; created_at: number };
export type AgentEvent =
  | { type: "message"; delta: string; item?: never }
  | ({ type: "message"; item: MessageItem; delta?: never } & Saved)
  | { type: "reasoning"; delta: string; item?: never }
  | ({ type: "reasoning"; item: ReasoningItem; delta?: never } & Saved)
  | ({ type: "function_call"; item: FunctionCallItem } & Saved)
  | ({ type: "function_call_output"; item: FunctionOutputItem } & Saved)
  | { type: "retry"; attempt: number; maxRetries: number; delayMs: number; error: string }
  | { type: "usage"; usage: Record<string, unknown> | null }
  | { type: "compact"; status: "started" }
  | {
      type: "compact";
      status: "completed";
      id: number;
      message_id: number;
      summary: string;
      created_at: number;
    }
  | { type: "done"; status: "completed" | "incomplete" | "aborted"; stopReason?: string }
  | { type: "error"; code: string; error: string };
export type ChatEvent = AgentEvent & { session_id: string };
