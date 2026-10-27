// 历史和实时消息使用同一种记录；显示行从记录生成，不保存第二份可变状态。
export type TextPart = {
  type: "input_text" | "output_text" | "summary_text" | "reasoning_text";
  text: string;
};
export type ImagePart = {
  type: "input_image";
  image_url: string;
  detail?: "auto" | "low" | "high";
};
export type ContentPart = TextPart | ImagePart | { type: "refusal"; refusal: string };
export interface MessageItem {
  type: "message";
  id?: string;
  role: "user" | "assistant" | "system" | "developer";
  content: ContentPart[];
}
export interface ReasoningItem {
  type: "reasoning";
  id?: string;
  summary: TextPart[];
  content?: TextPart[];
}
export interface FunctionCallItem {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
}
export interface FunctionOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string | ContentPart[];
}
export type StoredItem = MessageItem | ReasoningItem | FunctionCallItem | FunctionOutputItem;
export interface RawMessage {
  id: number;
  item: StoredItem;
  created_at?: number;
  key?: string;
  sequence?: number;
  usage?: Record<string, unknown> | null;
  streaming?: boolean;
  sending?: boolean;
  failed?: boolean;
}
export interface Compaction {
  id: number;
  message_id: number;
  summary: string;
  created_at: number;
}
export interface Row {
  key: string;
  kind: "user" | "assistant" | "tool" | "system";
  at?: number;
  content?: string;
  images?: string[];
  sending?: boolean;
  failed?: boolean;
  reasoning?: string;
  streaming?: boolean;
  /** 这条消息所在的那次模型响应用掉的 token 总数，只有响应的最后一条才有。 */
  tokens?: number;
  code?: "stopped" | "error" | "compacted" | "";
  callId?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
  status?: "running" | "done";
}
export function itemText(item: MessageItem | ReasoningItem): string {
  if (item.type === "reasoning") {
    return [...item.summary, ...(item.content || [])].map((part) => part.text).join("");
  }
  return item.content
    .map((part) => {
      if ("text" in part) {
        return part.text;
      }
      if (part.type === "refusal") {
        return part.refusal;
      }
      return "";
    })
    .join("");
}
function images(parts: ContentPart[]): string[] {
  return parts
    .filter((part): part is ImagePart => part.type === "input_image")
    .map((part) => part.image_url);
}

function totalTokens(message: RawMessage) {
  const total = message.usage?.total_tokens;
  if (typeof total === "number") {
    return total;
  }
  return undefined;
}

// 分页先合并原始记录，再按 call_id 配对。跨页的调用与结果只显示一行。
export function mergeMessages(older: RawMessage[], current: RawMessage[]): RawMessage[] {
  const records = new Map<number, RawMessage>();
  for (const message of [...older, ...current]) {
    records.set(message.id, message);
  }
  return [...records.values()].sort((a, b) => a.id - b.id);
}

export function buildRows(
  messages: RawMessage[],
  compactions: Compaction[] = [],
  busy = false,
): Row[] {
  const rows: Row[] = [];
  const calls = new Map<string, Row>();
  // 压缩行按覆盖位置插入；早于当前页的摘要放在页首，加载旧页后自动归位。
  let compactIndex = 0;
  const summaries = [...compactions].sort((a, b) => a.message_id - b.message_id || a.id - b.id);
  const appendCompaction = (summary: Compaction) => {
    rows.push({
      key: `compact:${summary.id}`,
      kind: "system",
      code: "compacted",
      content: summary.summary,
      at: summary.created_at,
    });
  };
  for (const message of messages) {
    while (
      compactIndex < summaries.length &&
      message.id > 0 &&
      summaries[compactIndex].message_id < message.id
    ) {
      appendCompaction(summaries[compactIndex++]);
    }
    const item = message.item;
    const key = message.key || `message:${message.id}`;
    const at = message.created_at;
    switch (item.type) {
      case "message":
        rows.push({
          key,
          at,
          kind: item.role === "user" ? "user" : "assistant",
          content: itemText(item),
          images: images(item.content),
          streaming: message.streaming,
          sending: message.sending,
          failed: message.failed,
          tokens: totalTokens(message),
        });
        break;
      case "reasoning":
        rows.push({
          key,
          at,
          kind: "assistant",
          reasoning: itemText(item),
          streaming: message.streaming,
        });
        break;
      case "function_call": {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(item.arguments);
        } catch {
          // 参数无效时仍展示调用；runner 返回明确的失败结果。
        }
        const row: Row = {
          key: `tool:${item.call_id}`,
          at,
          kind: "tool",
          callId: item.call_id,
          name: item.name,
          args,
          result: "",
          status: busy ? "running" : "done",
        };
        calls.set(item.call_id, row);
        rows.push(row);
        break;
      }
      case "function_call_output": {
        let row = calls.get(item.call_id);
        if (!row) {
          row = {
            key: `tool:${item.call_id}`,
            at,
            kind: "tool",
            callId: item.call_id,
            name: "tool",
            status: "done",
          };
          calls.set(item.call_id, row);
          rows.push(row);
        }
        const text =
          typeof item.output === "string"
            ? item.output
            : item.output
                .filter((part): part is TextPart => part.type === "input_text")
                .map((part) => part.text)
                .join("\n");
        const result: { success: boolean; text: string } = JSON.parse(text);
        row.result = result.text;
        row.failed = !result.success;
        row.images = typeof item.output === "string" ? [] : images(item.output);
        row.status = "done";
        break;
      }
    }
    while (
      compactIndex < summaries.length &&
      message.id > 0 &&
      summaries[compactIndex].message_id === message.id
    ) {
      appendCompaction(summaries[compactIndex++]);
    }
  }
  while (compactIndex < summaries.length) {
    appendCompaction(summaries[compactIndex++]);
  }
  return rows;
}
