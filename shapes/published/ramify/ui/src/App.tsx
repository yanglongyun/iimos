// 路由只有两屏:首页(#/)和项目页(#/p/<id>,三栏:对话 | 画布 | 预览)。模型配置是一层浮在上面的表单。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useApp } from './store';
import { buildRows } from './lib/chat';
import { Home } from './components/Home';
import { Canvas } from './components/Canvas';
import { ChatPanel } from './components/ChatPanel';
import { PaneDivider } from './components/PaneDivider';
import { Setup } from './components/Setup';

const CHAT = { default: 400, min: 300, max: 640 };

function readRoute(): string | null {
    const match = location.hash.match(/^#\/p\/([\w-]+)$/);
    return match ? match[1] : null;
}

export function App() {
    const [projectId, setProjectId] = useState<string | null>(readRoute);
    const { state, toast, showToast, refresh, loadProject, loadOlder } = useApp(projectId);
    const [setupOpen, setSetupOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [chatWidth, setChatWidth] = useState(CHAT.default);
    const [scrollSeq, setScrollSeq] = useState(0);
    const { config, projects, snapshot } = state;
    useEffect(() => { setSelectedId(null); setScrollSeq((n) => n + 1); }, [projectId]);

    useEffect(() => {
        const onHash = () => setProjectId(readRoute());
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    // 没接上模型就弹出配置
    useEffect(() => { if (config && !config.ready) setSetupOpen(true); }, [config]);

    const go = useCallback((id: string | null) => {
        const token = new URLSearchParams(location.search).get('token') || '';
        history.pushState(null, '', `${location.pathname}?token=${encodeURIComponent(token)}${id ? `#/p/${id}` : '#/'}`);
        setProjectId(id);
    }, []);

    const saveConfig = useCallback(async (patch: Record<string, string>) => {
        await api.saveConfig(patch);
        await refresh();
        setSetupOpen(false);
    }, [refresh]);

    const onCreate = useCallback(async (prompt: string, count: number) => {
        const { project } = await api.createProject(prompt, count);
        go(project.id);
    }, [go]);
    const onDelete = useCallback(async (id: string) => {
        try { await api.deleteProject(id); await refresh(); } catch (error) { showToast((error as Error).message); }
    }, [refresh, showToast]);
    const send = useCallback(async (text: string, nodeId: string | null, count: number) => {
        if (!projectId) return;
        if (!config?.ready) { setSetupOpen(true); return; }
        setScrollSeq((n) => n + 1);
        await api.send(projectId, text, nodeId, count);
    }, [projectId, config]);
    const onSay = useCallback((text: string) => send(text, selectedId, 0).catch((error) => showToast(error.message)), [send, selectedId, showToast]);
    const onBranch = useCallback((nodeId: string, prompt: string, count: number) => send(prompt, nodeId, count), [send]);
    const onStop = useCallback(() => { if (projectId) void api.stop(projectId).catch((error) => showToast(error.message)); }, [projectId, showToast]);

    const rows = useMemo(() => (snapshot ? buildRows(snapshot.messages, snapshot.compactions, state.notes, snapshot.partial) : []), [snapshot, state.notes]);
    const selected = useMemo(() => snapshot?.nodes.find((node) => node.id === selectedId) ?? null, [snapshot, selectedId]);
    const openSetup = useCallback(() => setSetupOpen(true), []);
    const maxChat = useCallback(() => Math.max(CHAT.min, Math.min(CHAT.max, window.innerWidth - 420)), []);

    const ready = Boolean(config?.ready);
    return (
        <>
            {projectId && snapshot && snapshot.project.id === projectId
                ? <main className="workspace">
                    <ChatPanel title={snapshot.project.title} rows={rows} busy={snapshot.running} hasMore={snapshot.has_more} selected={selected}
                        width={chatWidth} scrollSeq={scrollSeq} onHome={() => go(null)} onSend={onSay} onStop={onStop}
                        onLoadOlder={() => loadOlder().catch((error) => showToast(error.message))} onClearSelection={() => setSelectedId(null)} />
                    <PaneDivider value={chatWidth} defaultValue={CHAT.default} min={CHAT.min} max={maxChat} direction={1} onChange={setChatWidth} />
                    <Canvas nodes={snapshot.nodes} title={snapshot.project.title} prompt={snapshot.project.prompt} selectedId={selectedId} setSelectedId={setSelectedId}
                        ready={ready} onBranch={onBranch} onSetup={openSetup} onToast={showToast} />
                </main>
                : projectId
                    ? <div className="loading">打开画布…</div>
                    : <Home projects={projects} ready={ready} onCreate={onCreate} onOpen={go} onDelete={onDelete} onSetup={() => setSetupOpen(true)} />}
            {setupOpen && <Setup config={config} onSave={saveConfig} onClose={() => setSetupOpen(false)} />}
            {toast && <div className="toast">{toast}</div>}
        </>
    );
}
