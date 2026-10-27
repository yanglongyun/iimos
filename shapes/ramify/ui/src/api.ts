// 本地服务的接口。令牌在窗口地址的 ?token= 里(由 main.js 生成),每个请求都带上;iframe 的地址用 ?token=。
import type { Config, Item, Project, Snapshot, TreeNode } from './types';

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
    createProject: (prompt: string, count: number) => req<{ project: Project; root: TreeNode }>('POST', '/api/projects', { prompt, count }),
    deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),
    project: (id: string) => req<Snapshot>('GET', `/api/projects/${id}`),
    olderMessages: (id: string, before: number) => req<{ messages: Item[]; has_more: boolean }>('GET', `/api/projects/${id}/messages?before=${before}`),
    send: (id: string, text: string, nodeId: string | null, count: number) =>
        req<{ item: Item }>('POST', `/api/projects/${id}/messages`, { text, node_id: nodeId, count }),
    stop: (id: string) => req<{ stopped: boolean }>('POST', `/api/projects/${id}/stop`),
    source: (nodeId: string) => req<{ node: TreeNode }>('GET', `/api/nodes/${nodeId}/source`),
    nodeHtmlUrl: (nodeId: string, revision?: string) =>
        `/api/nodes/${nodeId}/html?token=${encodeURIComponent(token)}${revision ? `&r=${encodeURIComponent(revision)}` : ''}`,
    eventsUrl: () => `/api/events?token=${encodeURIComponent(token)}`,
};
