// 界面状态。真相在服务端:先 GET /api/state 拿全量,再订阅 /api/events(SSE)接增量。
// 窗口被 reload(包括 agent 改完界面自己 reload)时,正在跑的那一轮不受影响,重新接上就行。
// SSE 断开期间推出来的事件不会补发,所以重连上之后再拉一次全量。
import { useCallback, useEffect, useState } from 'react';

import { api, eventsUrl } from './api';
import type { Config, Item, State, Workspace } from './types';

const initial: State = { items: [], running: false, partial: '', tokens: 0, config: null, workspace: null };

type Snapshot = { items: Item[]; running: boolean; partial: string; tokens: number; config: Config; workspace: Workspace };

export function useConversation() {
    const [state, setState] = useState<State>(initial);

    const refresh = useCallback(async () => {
        const snap = await api<Snapshot>('GET', '/api/state');
        setState({ ...snap, partial: snap.partial || '' });
    }, []);

    /** 只在本地显示的一行(错误、停下、重试、压缩中),不存盘。 */
    const note = useCallback((kind: 'error' | 'stopped' | 'retry' | 'compacting', text: string) => {
        setState((s) => ({ ...s, items: [...s.items, { type: 'local', kind, text }] }));
    }, []);

    useEffect(() => {
        refresh().catch((error) => note('error', `连不上本地服务:${error.message}`));
        const events = new EventSource(eventsUrl());
        let dropped = false;
        events.onerror = () => { dropped = true; };
        events.onopen = () => { if (dropped) { dropped = false; void refresh(); } };
        events.onmessage = (message) => {
            const event = JSON.parse(message.data);
            switch (event.type) {
                case 'delta':
                    setState((s) => ({ ...s, partial: s.partial + event.text }));
                    break;
                case 'item':
                    setState((s) => ({
                        ...s,
                        items: [...s.items, event.item],
                        // 完整的回复到了,流式那半句就该收起来
                        partial: event.item.type === 'message' && event.item.role === 'assistant' ? '' : s.partial,
                    }));
                    break;
                case 'state':
                    setState((s) => ({ ...s, running: event.running, partial: event.running ? s.partial : '' }));
                    break;
                case 'usage':
                    setState((s) => ({ ...s, tokens: event.tokens }));
                    break;
                case 'config':
                    setState((s) => ({ ...s, config: event.config }));
                    break;
                case 'retry':
                    note('retry', `模型请求失败,${event.attempt}/${event.maxRetries} 次重试中:${event.error}`);
                    break;
                case 'compacting':
                    note('compacting', '压缩上下文中……');
                    break;
                case 'compacted':
                    // 压缩标记插在对话中间,按位置重拉全量最省事
                    void refresh();
                    break;
                case 'error':
                    note(event.message === '已停止' ? 'stopped' : 'error', event.message);
                    break;
                default:
            }
        };
        return () => events.close();
    }, [refresh, note]);

    const send = useCallback(async (text: string) => {
        await api('POST', '/api/send', { text });
    }, []);
    const stop = useCallback(() => { void api('POST', '/api/stop').catch(() => {}); }, []);
    const saveConfig = useCallback(async (patch: Record<string, string>) => {
        const { config } = await api<{ config: Config }>('POST', '/api/config', patch);
        setState((s) => ({ ...s, config }));
        return config;
    }, []);

    return { state, send, stop, saveConfig, note };
}
