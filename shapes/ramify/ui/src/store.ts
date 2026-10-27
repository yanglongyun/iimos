// 界面状态。真相在服务端:先 GET 拿全量,再订阅 /api/events(SSE)接增量。
// 当前打开的项目(树 + 对话)整个存在这里;节点事件替换对应节点,条目事件追加到对话。SSE 断开再连上时重拉全量。
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';
import type { Config, Id, Item, Project, Snapshot, TreeNode } from './types';

export type Note = { key: string; kind: 'error' | 'retry' | 'compacting'; text: string; afterId: number };

export type State = {
    config: Config | null;
    projects: Project[];
    snapshot: Snapshot | null;
    /** 只在本地显示的一行(错误、停下、重试、压缩中),不存盘 */
    notes: Note[];
};

const initial: State = { config: null, projects: [], snapshot: null, notes: [] };
let noteSeq = 0;

export function useApp(projectId: Id | null) {
    const [state, setState] = useState<State>(initial);
    const [toast, setToast] = useState<string | null>(null);
    const current = useRef<Id | null>(projectId);
    current.current = projectId;

    const showToast = useCallback((text: string) => {
        setToast(text);
        setTimeout(() => setToast((now) => (now === text ? null : now)), 2600);
    }, []);

    const refresh = useCallback(async () => {
        const snap = await api.state();
        setState((s) => ({ ...s, config: snap.config, projects: snap.projects }));
    }, []);

    const loadProject = useCallback(async (id: Id) => {
        const snapshot = await api.project(id);
        if (current.current !== id) return;
        setState((s) => ({ ...s, snapshot, notes: [] }));
    }, []);

    const note = useCallback((kind: Note['kind'], text: string) => {
        setState((s) => {
            const last = s.snapshot?.messages[s.snapshot.messages.length - 1];
            return { ...s, notes: [...s.notes, { key: `note-${++noteSeq}`, kind, text, afterId: last?.id ?? 0 }] };
        });
    }, []);

    useEffect(() => {
        refresh().catch((error) => showToast(`连不上本地服务:${error.message}`));
    }, [refresh, showToast]);

    useEffect(() => {
        if (!projectId) { setState((s) => ({ ...s, snapshot: null, notes: [] })); return; }
        loadProject(projectId).catch((error) => showToast(error.message));
    }, [projectId, loadProject, showToast]);

    useEffect(() => {
        const events = new EventSource(api.eventsUrl());
        let dropped = false;
        events.onerror = () => { dropped = true; };
        events.onopen = () => {
            if (!dropped) return;
            dropped = false;
            void refresh();
            if (current.current) void loadProject(current.current);
        };
        const patch = (fn: (snapshot: Snapshot) => Snapshot) => setState((s) => (s.snapshot ? { ...s, snapshot: fn(s.snapshot) } : s));
        events.onmessage = (message) => {
            const event = JSON.parse(message.data);
            if (event.project_id && event.project_id !== current.current) {
                if (event.type === 'state') void refresh();
                return;
            }
            switch (event.type) {
                case 'node': {
                    const node = event.node as TreeNode;
                    patch((snap) => {
                        const nodes = snap.nodes.some((n) => n.id === node.id)
                            ? snap.nodes.map((n) => (n.id === node.id ? { ...node, seq: n.seq } : n))
                            : [...snap.nodes, { ...node, seq: snap.nodes.length + 1 }];
                        return { ...snap, nodes };
                    });
                    break;
                }
                case 'delta':
                    patch((snap) => ({ ...snap, partial: snap.partial + event.text }));
                    break;
                case 'item': {
                    const item = event.item as Item;
                    patch((snap) => (snap.messages.some((m) => m.id === item.id) ? snap : {
                        ...snap,
                        messages: [...snap.messages, item],
                        partial: item.type === 'message' && item.role === 'assistant' ? '' : snap.partial,
                    }));
                    break;
                }
                case 'state':
                    patch((snap) => ({ ...snap, running: event.running, partial: event.running ? snap.partial : '' }));
                    if (!event.running) void refresh();
                    break;
                case 'usage':
                    patch((snap) => ({ ...snap, tokens: event.tokens }));
                    break;
                case 'retry':
                    note('retry', `模型请求失败,${event.attempt}/${event.maxRetries} 次重试中:${event.error}`);
                    break;
                case 'compacting':
                    note('compacting', '压缩上下文中……');
                    break;
                case 'compacted':
                    if (current.current) void loadProject(current.current);
                    break;
                case 'error':
                    note('error', event.message);
                    break;
                case 'config':
                    setState((s) => ({ ...s, config: event.config }));
                    break;
                case 'project':
                    void refresh();
                    break;
                default:
            }
        };
        return () => events.close();
    }, [refresh, loadProject, note]);

    const loadOlder = useCallback(async () => {
        const snap = state.snapshot;
        if (!snap || !snap.has_more || !snap.messages.length) return;
        const page = await api.olderMessages(snap.project.id, snap.messages[0].id);
        setState((s) => (s.snapshot && s.snapshot.project.id === snap.project.id
            ? { ...s, snapshot: { ...s.snapshot, messages: [...page.messages, ...s.snapshot.messages], has_more: page.has_more } }
            : s));
    }, [state.snapshot]);

    return { state, toast, showToast, refresh, loadProject, loadOlder, note };
}
