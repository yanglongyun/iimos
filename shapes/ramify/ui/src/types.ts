// 服务端返回的数据形状。
export type Id = string;
export type NodeType = 'text' | 'html' | 'markdown' | 'svg' | 'error';
export const ARTIFACT_TYPES: NodeType[] = ['html', 'markdown', 'svg'];
export const isArtifact = (type: NodeType) => ARTIFACT_TYPES.includes(type);

export type Project = {
    id: Id;
    title: string;
    prompt: string;
    created_at: string;
    updated_at: string;
    done_count?: number;
    generating_count?: number;
    preview_node_id?: Id | null;
    running?: boolean;
};

export type TreeNode = {
    id: Id;
    project_id: Id;
    parent_id: Id | null;
    position: number;
    type: NodeType;
    title: string;
    content: string | null;
    run_id: string | null;
    created_at: string;
    updated_at: string;
    seq: number;
};

// 对话条目:服务端存的就是 Responses 协议的 input item,外加 id / created_at;用户消息还带 display(原话)和 node(选中的节点、要几版)
export type Part = { type: string; text?: string };
type Saved = { id: number; created_at: string };
export type Item = Saved & (
    | { type: 'message'; role: 'user'; content: Part[]; display?: string; node?: { id?: Id; title?: string; count?: number } }
    | { type: 'message'; role: 'assistant'; content: Part[] }
    | { type: 'function_call'; call_id: string; name: string; arguments: string }
    | { type: 'function_call_output'; call_id: string; output: string }
    | { type: 'reasoning' }
);
export type Compaction = { id: number; message_id: number; summary: string; created_at: string };

export type Snapshot = {
    project: Project;
    nodes: TreeNode[];
    messages: Item[];
    has_more: boolean;
    compactions: Compaction[];
    running: boolean;
    partial: string;
    tokens: number;
};

export type Config = {
    responsesUrl: string;
    model: string;
    contextWindow: number;
    hasKey: boolean;
    keyHint: string;
    ready: boolean;
};
