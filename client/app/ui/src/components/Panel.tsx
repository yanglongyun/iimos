// 面板:它醒着时在干什么。定时任务、手(电脑操作 / 浏览器 / 通知)。
// 和模型配置一样是一个小终端窗口,右上角 ≡ 打开,esc 关。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type Task = { id: string; title: string; prompt: string; when: string; enabled: boolean; lastRun: string | null; nextRun: string | null };
type Hand = { id: string; name: string; tools: string[] };
type Hub = { hands: Hand[] };

const TOOL_NAMES: Record<string, string> = { computer: '电脑操作', browser: '浏览器', notify: '通知' };
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function Panel({ onClose }: { onClose: () => void }) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [hub, setHub] = useState<Hub | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const [t, h] = await Promise.all([api<{ tasks: Task[] }>('GET', '/api/tasks'), api<Hub>('GET', '/api/hub')]);
            setTasks(t.tasks);
            setHub(h);
        } catch (cause) { setError((cause as Error).message); }
    }, []);
    useEffect(() => { void load(); const timer = setInterval(load, 5000); return () => clearInterval(timer); }, [load]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const act = async (fn: () => Promise<unknown>) => { setError(''); try { await fn(); await load(); } catch (cause) { setError((cause as Error).message); } };
    return (
        <div className="sheet" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <div className="setup panel">
                <div className="setup-bar">
                    <span>panel — 醒着的时候</span>
                    <button type="button" className="x" aria-label="关闭" onClick={onClose}>esc</button>
                </div>

                <h4>定时任务</h4>
                {tasks.length ? tasks.map((task) => (
                    <div key={task.id} className={`row${task.enabled ? '' : ' off'}`}>
                        <span className="what" title={task.prompt}><b>{task.title}</b> {task.when}</span>
                        <span className="meta">下次 {task.enabled ? time(task.nextRun) : '已暂停'}</span>
                        <span className="acts">
                            <button type="button" onClick={() => act(() => api('POST', '/api/tasks/run', { id: task.id }))}>跑</button>
                            <button type="button" onClick={() => act(() => api('POST', '/api/tasks/update', { id: task.id, enabled: !task.enabled }))}>{task.enabled ? '停' : '开'}</button>
                            <button type="button" onClick={() => { if (confirm(`删掉「${task.title}」?`)) void act(() => api('POST', '/api/tasks/remove', { id: task.id })); }}>删</button>
                        </span>
                    </div>
                )) : <p className="hint">还没有。跟它说「每天早上 8 点给我一份早报」这样的话,它就会定下来。</p>}

                <h4>手</h4>
                {hub?.hands.length ? hub.hands.map((hand) => (
                    <div key={hand.id} className="row">
                        <span className="what"><b>{hand.name}</b></span>
                        <span className="meta">{hand.tools.map((t) => TOOL_NAMES[t] || t).join(' · ')}</span>
                    </div>
                )) : <p className="hint">没有可用的手。</p>}
                <p className="hint small">电脑操作要在菜单栏 iimos 图标里勾上「允许它操作这台电脑」。⌘⇧Esc 随时叫停。</p>

                {error && <p className="hint small" style={{ color: 'var(--bad)' }}>{error}</p>}
            </div>
        </div>
    );
}
