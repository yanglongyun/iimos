// 主界面:顶栏 + 一块滚动区(开机横幅、执行日志)+ 提示符 + 模型配置。
// 还没有任何对话时(fresh),横幅在屏幕中间,提示符就在它下面;一开口,提示符挪到底部。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useConversation } from './store';
import { Bar } from './components/Bar';
import { Banner } from './components/Banner';
import { Log } from './components/Log';
import { Composer } from './components/Composer';
import { Setup } from './components/Setup';

export function App() {
    const { state, send, stop, saveConfig, note } = useConversation();
    const { items, running, partial, tokens, config, workspace } = state;
    const [setupOpen, setSetupOpen] = useState(false);
    const fresh = items.length === 0 && !running;

    // 没接上模型就弹出配置
    useEffect(() => { if (config && !config.ready) setSetupOpen(true); }, [config]);
    // 配置窗关掉后,焦点回到提示符:接着就能打字
    useEffect(() => {
        if (!setupOpen) document.querySelector<HTMLTextAreaElement>('.prompt textarea')?.focus();
    }, [setupOpen]);
    // 像终端一样:哪儿都没有焦点时直接打字,字落进提示符(开窗时焦点没给上、点了别处之后都管用)
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (setupOpen || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
            const active = document.activeElement;
            if (active && active !== document.body) return;
            document.querySelector<HTMLTextAreaElement>('.prompt textarea')?.focus();
        };
        // 窗口重新拿到焦点时(切回来、刚开窗还没聚焦),同样把焦点交给提示符
        const onFocus = () => {
            if (setupOpen || (document.activeElement && document.activeElement !== document.body)) return;
            document.querySelector<HTMLTextAreaElement>('.prompt textarea')?.focus();
        };
        document.addEventListener('keydown', onKey);
        window.addEventListener('focus', onFocus);
        return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('focus', onFocus); };
    }, [setupOpen]);
    // body 上的状态类:样式按它切换初始 / 对话中、运行中。
    // 用 layout effect:要在 Composer 聚焦(普通 effect)之前挂上 —— 没有 fresh 类时提示符所在的块是 display:none,聚焦会落空
    useLayoutEffect(() => {
        document.body.classList.toggle('fresh', fresh);
        document.body.classList.toggle('running', running);
    }, [fresh, running]);
    // Esc 停下(配置窗开着时,Esc 归配置窗)
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !setupOpen && running) stop(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [setupOpen, running, stop]);

    // 用户在底部附近时跟着滚;往上翻历史时不打扰
    const scroller = useRef<HTMLElement>(null);
    const follow = useRef(true);
    useLayoutEffect(() => {
        const el = scroller.current;
        if (el && follow.current) el.scrollTop = el.scrollHeight;
    }, [items, partial]);

    const onSend = useCallback(async (text: string) => {
        if (!config?.ready) { setSetupOpen(true); return false; }
        follow.current = true;
        try { await send(text); return true; } catch (error) { note('error', (error as Error).message); return false; }
    }, [config, send, note]);

    const composer = <Composer running={running} onSend={onSend} onStop={stop} />;

    return (
        <>
            <Bar config={config} tokens={tokens} onModel={() => setSetupOpen(true)} />
            <main
                className="scroll"
                ref={scroller}
                onScroll={(event) => {
                    const el = event.currentTarget;
                    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
            >
                <Banner workspace={workspace} config={config} onSetup={() => setSetupOpen(true)}>{fresh ? composer : null}</Banner>
                <Log items={items} partial={partial} running={running} />
            </main>
            {!fresh && <footer className="bottom">{composer}</footer>}
            {setupOpen && (
                <Setup
                    config={config}
                    onClose={() => setSetupOpen(false)}
                    onSave={async (patch) => {
                        const next = await saveConfig(patch);
                        if (next.ready) setSetupOpen(false);
                    }}
                />
            )}
        </>
    );
}
