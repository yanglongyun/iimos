// 对话条目:服务端存的就是 Responses 协议的 input items,外加几种只给界面看的标记。
export type Part = { type: string; text?: string };

export type Item =
    | { type: 'message'; role: 'user' | 'assistant'; content: Part[] }
    | { type: 'function_call'; call_id: string; name: string; arguments: string }
    | { type: 'function_call_output'; call_id: string; output: string }
    | { type: 'reasoning' }
    | { type: 'compaction'; summary: string; covered: number }
    | { type: 'restart'; stopped?: boolean }
    // 下面几种只在本地,不存盘:刷新后就没了
    | { type: 'local'; kind: 'error' | 'stopped' | 'retry' | 'compacting'; text: string };

export type Config = {
    responsesUrl: string;
    model: string;
    contextWindow: number;
    hasKey: boolean;
    keyHint: string;
    ready: boolean;
};

export type Workspace = { version: string; commit: string };

export type State = {
    items: Item[];
    running: boolean;
    partial: string;
    tokens: number;
    config: Config | null;
    workspace: Workspace | null;
};
