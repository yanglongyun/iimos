// 引擎与适配层共用的形状。数据来自 iimos 形态的导图接口;id 是字符串。
export type Side = 'left' | 'right';
export type TopicId = string;

export interface Topic {
    id: TopicId;
    parent_id: TopicId | null;
    text: string;
    note?: string;
    side?: Side;
    sort_order: number;
    collapsed?: 0 | 1;
    created_at: number;
}

/** 引擎的三个持久化出口。引擎乐观更新、失败回滚,适配器只管照做和抛错。 */
export interface SaveAdapter {
    create(input: { parentId: TopicId | null; text: string; side: Side; sortOrder: number }): Promise<Topic>;
    patch(id: TopicId, patch: Partial<{ text: string; collapsed: boolean; side: Side; sortOrder: number; parentId: TopicId }>): Promise<void>;
    reorder(id: TopicId, beforeId: TopicId | null): Promise<void>;
    remove(id: TopicId): Promise<void>;
}

/** 引擎把状态推出来,外壳负责显示 —— 引擎不认识 React。 */
export interface MindmapUI {
    onSelection(selected: TopicId | null): void;
    onZoom(zoom: number): void;
    onCount(count: number): void;
    onError(message: string): void;
}

export interface MindmapEngine {
    addChild(): void;
    addSibling(): void;
    removeSelected(): void;
    /** 根主题删不得 */
    canRemove(id: TopicId | null): boolean;
    zoomBy(factor: number): void;
    reset(): void;
    fit(): void;
    /** 外部(agent / 对话)改了数据后,原地替换,不重建画布。 */
    setTopics(topics: Topic[]): void;
    select(id: TopicId | null): void;
    destroy(): void;
}
