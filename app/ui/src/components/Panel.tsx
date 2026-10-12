// 面板:它醒着时在干什么。定时任务、手(电脑操作 / 浏览器 / 通知)、手机。
// 和模型配置一样是一个小终端窗口,右上角 ≡ 打开,esc 关。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type Task = { id: string; title: string; prompt: string; when: string; enabled: boolean; lastRun: string | null; nextRun: string | null };
type Hand = { id: string; name: string; tools: string[]; remote?: boolean };
type Device = { id: string; name: string; kind: string; online: boolean; lastSeen: string | null };
type Hub = { host: string | null; hands: Hand[]; remote: { enabled: boolean; connected: boolean; relay: string | null; devices: Device[] } | null };

const TOOL_NAMES: Record<string, string> = { computer: '电脑操作', browser: '浏览器', notify: '通知' };
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function Panel({ onClose }: { onClose: () => void }) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [hub, setHub] = useState<Hub | null>(null);
    const [pairing, setPairing] = useState<{ link: string; svg: string | null } | null>(null);
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
    const pair = () => act(async () => setPairing(await api<{ link: string; svg: string | null }>('POST', '/api/remote/pair', { name: '手机' })));

    const phones = hub?.remote?.devices.filter((d) => d.kind === 'device') || [];
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
                        <span className="what"><b>{hand.name}</b>{hand.remote ? ' (借来的)' : ''}</span>
                        <span className="meta">{hand.tools.map((t) => TOOL_NAMES[t] || t).join(' · ')}</span>
                    </div>
                )) : <p className="hint">{hub?.host === 'server' ? '服务器上没有手。在你的电脑上装 iimos,用 iimos hands link 把手借给这里。' : '没有可用的手。'}</p>}
                {hub?.host === 'desktop' && <p className="hint small">电脑操作要在菜单栏 iimos 图标里勾上「允许它操作这台电脑」。⌘⇧Esc 随时叫停。</p>}

                <h4>手机</h4>
                {phones.map((d) => (
                    <div key={d.id} className="row">
                        <span className="what"><b>{d.name}</b> {d.online ? <em className="on">在线</em> : <em>上次 {time(d.lastSeen)}</em>}</span>
                        <span className="acts"><button type="button" onClick={() => { if (confirm(`吊销「${d.name}」?它将再也连不上。`)) void act(() => api('POST', '/api/remote/revoke', { id: d.id })); }}>吊销</button></span>
                    </div>
                ))}
                {hub?.remote ? (
                    pairing ? (
                        <div className="pair">
                            {pairing.svg && <div className="qr" dangerouslySetInnerHTML={{ __html: pairing.svg }} />}
                            <p className="hint small">用手机相机扫一下。这个码就是钥匙,别给别人看。内容端到端加密,中继看不到。</p>
                            <input readOnly value={pairing.link} onFocus={(e) => e.currentTarget.select()} />
                            <button type="button" className="go" onClick={() => setPairing(null)}>[ 好了 ]</button>
                        </div>
                    ) : (
                        <>
                            <p className="hint small">中继 {hub.remote.enabled ? (hub.remote.connected ? '已连上' : '连接中…') : '没开'}{hub.remote.relay ? ` · ${hub.remote.relay.replace(/^https?:\/\//, '')}` : ''}</p>
                            <button type="button" className="go" onClick={() => void pair()}>[ 配对手机 ]</button>
                        </>
                    )
                ) : <p className="hint">单独跑的应用没有远程访问。</p>}

                {error && <p className="hint small" style={{ color: 'var(--bad)' }}>{error}</p>}
            </div>
        </div>
    );
}
