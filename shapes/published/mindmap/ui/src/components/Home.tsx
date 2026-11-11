// 首屏:写下一个中心主题,agent 展开第一版;下面是之前画过的导图。
import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { Mark } from './Mark';

const MAX = 2000;
const STARTERS = ['产品规划', '项目复盘', '读书笔记', '学习路线', '商业画布', '一篇文章'];

export function Home({ projects, ready, onCreate, onOpen, onDelete, onSetup }: {
    projects: Project[];
    ready: boolean;
    onCreate: (title: string) => Promise<void>;
    onOpen: (id: string) => void;
    onDelete: (id: string) => Promise<void>;
    onSetup: () => void;
}) {
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const area = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { area.current?.focus(); }, []);

    const submit = async () => {
        if (!title.trim() || busy) return;
        if (!ready) { onSetup(); return; }
        setBusy(true); setError('');
        try { await onCreate(title.trim()); setTitle(''); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };

    return (
        <div className="home dot">
            <div className="home-corner"><Mark size={20} /><b>mindmap</b></div>
            <button className="home-model" onClick={onSetup}><span className={ready ? 'on' : ''} />{ready ? '模型' : '连接模型'}</button>
            <div className="home-board">
                <header className="home-head">
                    <div className="home-kicker">THINK · CONNECT · GROW</div>
                    <h1>把一件事，<br />想成一棵树。</h1>
                    <p>写下一个中心主题。你的 agent 会先搭出几个方向，再和你一起把每一支想深。</p>
                    <form className="ticket" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                        <div className="ticket-tabs">
                            {STARTERS.map((label) => (
                                <button key={label} type="button" onClick={() => { setTitle(label); area.current?.focus(); }}>{label}</button>
                            ))}
                        </div>
                        <textarea ref={area} value={title} maxLength={MAX} placeholder="比如：明年的产品计划、这本书的核心观点、一次旅行的路线……"
                            onChange={(event) => setTitle(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
                            }} />
                        <div className="ticket-row">
                            <span className="ticket-count">先长出 3–6 个主要分支，之后随时继续</span>
                            <button type="submit" className="primary start" disabled={!title.trim() || busy}>{busy ? '正在展开…' : '开始梳理'}</button>
                        </div>
                    </form>
                    {error && <p className="hint error">{error}</p>}
                </header>
                {projects.length > 0 && (
                    <section className="boards">
                        {projects.map((project) => (
                            <article key={project.id} className="card" onClick={() => onOpen(project.id)}>
                                <div className="card-shot">
                                    <div className="card-map" aria-hidden="true">
                                        <i className="map-root" />
                                        <i className="map-line l1" /><i className="map-line l2" /><i className="map-line l3" />
                                        <i className="map-node n1" /><i className="map-node n2" /><i className="map-node n3" />
                                    </div>
                                </div>
                                <div className="card-meta">
                                    <div className="card-title">{project.title}</div>
                                    <div className="card-sub">
                                        {Math.max(0, (project.topic_count ?? ((project.node_count || 1) - 1)))} 个主题
                                        <span> · {new Date(project.updated_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                                <button className="card-del" title="删除这张导图" onClick={(event) => { event.stopPropagation(); void onDelete(project.id); }}>✕</button>
                            </article>
                        ))}
                    </section>
                )}
            </div>
        </div>
    );
}
