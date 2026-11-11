// 首屏:一个输入框 + 方案数量;下面是之前长过的画布。
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { Project } from '../types';
import { CountPicker } from './CountPicker';
import { Mark } from './Mark';
import { randomPlant } from '../lib/plants';

const MAX = 2000;
const STARTERS: Array<[string, string]> = [
    ['落地页', '为一个新产品设计落地页,生成几个风格方向'],
    ['海报', '设计一张主题海报,探索不同的视觉语言'],
    ['原型', '做一个可交互的产品原型,比较不同的信息架构'],
    ['Logo', '为一个新品牌设计 logo,生成几个明显不同的方向'],
    ['文档', '把这个想法整理成一份结构完整、易读的文档'],
    ['插画', '创作一幅主题插画,生成几个不同的艺术方向'],
];

export function Home({ projects, ready, onCreate, onOpen, onDelete, onSetup }: {
    projects: Project[];
    ready: boolean;
    onCreate: (prompt: string, count: number) => Promise<void>;
    onOpen: (id: string) => void;
    onDelete: (id: string) => Promise<void>;
    onSetup: () => void;
}) {
    const [prompt, setPrompt] = useState('');
    const [count, setCount] = useState(3);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const area = useRef<HTMLTextAreaElement>(null);
    const plant = useMemo(() => randomPlant(), []);
    useEffect(() => { area.current?.focus(); }, []);

    const submit = async () => {
        if (!prompt.trim() || busy) return;
        if (!ready) { onSetup(); return; }
        setBusy(true); setError('');
        try { await onCreate(prompt.trim(), count); setPrompt(''); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };

    return (
        <div className="home dot">
            <div className="home-corner"><Mark size={20} /><b>ramify</b></div>
            <button className="home-model" onClick={onSetup}><span className={ready ? 'on' : ''} />{ready ? '模型' : '连接模型'}</button>
            <div className="home-board">
                <header className="home-head">
                    <div className="home-plant" title={plant.name} aria-hidden="true" dangerouslySetInnerHTML={{ __html: plant.svg }} />
                    <h1>让一个想法,长成一片创意</h1>
                    <p>写一句话,定好出几版。每一版都是树上独立的一支 —— 挑中最好的那支,继续往下长。</p>
                    <form className="ticket" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                        <div className="ticket-tabs">
                            {STARTERS.map(([label, template]) => (
                                <button key={label} type="button" onClick={() => { setPrompt(template); area.current?.focus(); }}>{label}</button>
                            ))}
                        </div>
                        <textarea ref={area} value={prompt} maxLength={MAX} placeholder="描述你想要的东西……"
                            onChange={(event) => setPrompt(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
                            }} />
                        <div className="ticket-row">
                            <CountPicker value={count} onChange={setCount} />
                            <span className="ticket-count">{count} 个方案</span>
                            <button type="submit" className="primary start" disabled={!prompt.trim() || busy}>{busy ? '发出去了…' : `生成 ${count} 版`}</button>
                        </div>
                    </form>
                    {error && <p className="hint error">{error}</p>}
                </header>
                {projects.length > 0 && (
                    <section className="boards">
                        {projects.map((project) => (
                            <article key={project.id} className="card" onClick={() => onOpen(project.id)}>
                                <div className="card-shot">
                                    {project.preview_node_id
                                        ? <iframe src={api.nodeHtmlUrl(project.preview_node_id)} sandbox="" scrolling="no" tabIndex={-1} title={project.title} loading="lazy" />
                                        : <div className="card-empty">{(project.generating_count || 0) > 0 ? '生成中…' : '还没有方案'}</div>}
                                </div>
                                <div className="card-meta">
                                    <div className="card-title">{project.title}</div>
                                    <div className="card-sub">
                                        {project.done_count || 0} 版
                                        {(project.generating_count || 0) > 0 && <em> · {project.generating_count} 生成中</em>}
                                        <span> · {new Date(project.updated_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                                <button className="card-del" title="删除这块画布" onClick={(event) => { event.stopPropagation(); void onDelete(project.id); }}>✕</button>
                            </article>
                        ))}
                    </section>
                )}
            </div>
        </div>
    );
}
