// 面板:它醒着时在干什么。现在是定时任务。
// 和模型配置一样是一个小终端窗口,右上角 ≡ 打开,esc 关。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type Task = { id: string; title: string; prompt: string; when: string; enabled: boolean; lastRun: string | null; nextRun: string | null };
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function Panel({ onClose }: { onClose: () => void }) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            setTasks((await api<{ tasks: Task[] }>('GET', '/api/tasks')).tasks);
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

                {error && <p className="hint small" style={{ color: 'var(--bad)' }}>{error}</p>}
            </div>
        </div>
    );
}
