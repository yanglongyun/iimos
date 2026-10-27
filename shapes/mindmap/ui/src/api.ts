// 本地服务的接口。令牌在窗口地址的 ?token= 里(由 main.js / launcher 生成),每个请求都带上。
import type { Config, Item, Project, Snapshot, Topic } from './types';

export const token = new URLSearchParams(location.search).get('token') || '';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
        method,
        headers: { 'x-iimos-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
    return data as T;
}

export const api = {
    state: () => req<{ config: Config; workspace: { version: string }; projects: Project[] }>('GET', '/api/state'),
    saveConfig: (patch: Record<string, string>) => req<{ config: Config }>('POST', '/api/config', patch),
    createProject: (title: string) => req<{ project: Project; root: Topic }>('POST', '/api/projects', { title }),
    deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),
    renameProject: (id: string, title: string) => req<{ project: Project }>('PATCH', `/api/projects/${id}`, { title }),
    project: (id: string) => req<Snapshot>('GET', `/api/projects/${id}`),
    olderMessages: (id: string, before: number) => req<{ messages: Item[]; has_more: boolean }>('GET', `/api/projects/${id}/messages?before=${before}`),
    send: (id: string, text: string, nodeId: string | null) =>
        req<{ item: Item }>('POST', `/api/projects/${id}/messages`, { text, node_id: nodeId }),
    stop: (id: string) => req<{ stopped: boolean }>('POST', `/api/projects/${id}/stop`),
    addTopic: (projectId: string, parentId: string, title: string, note: string, side: 'left' | 'right' = 'right', sortOrder?: number) =>
        req<{ node: Topic }>('POST', `/api/projects/${projectId}/topics`, { parent_id: parentId, title, note, side, sort_order: sortOrder }),
    updateTopic: (id: string, patch: Record<string, unknown>) => req<{ node: Topic }>('PATCH', `/api/topics/${id}`, patch),
    moveTopic: (id: string, parentId: string, position?: number) => req<{ node: Topic }>('POST', `/api/topics/${id}/move`, { parent_id: parentId, position }),
    reorderTopic: (id: string, beforeId: string | null) => req<{ nodes: Topic[] }>('POST', `/api/topics/${id}/reorder`, { before_id: beforeId }),
    deleteTopic: (id: string) => req<{ deleted: string[] }>('DELETE', `/api/topics/${id}`),
    eventsUrl: () => `/api/events?token=${encodeURIComponent(token)}`,
};
