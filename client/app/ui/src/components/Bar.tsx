// 顶栏:整条可拖窗口。右边是上下文用量、当前模型(点开模型配置),
// 和无框窗口(Windows/Linux)的窗口钮 —— 桌面壳注入了 window.morphicWin 才画;macOS 用原生红绿灯
import type { Config } from '../types';

const winButtons = typeof window !== 'undefined' ? window.morphicWin : undefined;

export function Bar({ config, tokens, onModel }: { config: Config | null; tokens: number; onModel: () => void }) {
    const pct = config?.contextWindow ? Math.round((tokens / config.contextWindow) * 100) : 0;
    return (
        <header className={`bar${winButtons ? ' frameless' : ''}`}>
            <span className="where"><b>morphic</b> ~/workspace</span>
            <span className="right">
                {/* 到 70% 会自动压缩,快到时标黄 */}
                <span className={`ctx${pct >= 60 ? ' high' : ''}`} title="上下文用量:到 70% 自动压缩">{tokens ? `ctx ${pct}%` : ''}</span>
                <button className={`model${config?.ready ? ' on' : ''}`} type="button" title="模型设置" onClick={onModel}>
                    {config?.ready ? config.model : '未连接'}
                </button>
                {winButtons && (
                    <span className="winbtns">
                        <button type="button" title="最小化" onClick={() => winButtons.minimize()}>─</button>
                        <button type="button" title="最大化 / 还原" onClick={() => winButtons.toggleMaximize()}>□</button>
                        <button type="button" className="close" title="关闭" onClick={() => winButtons.close()}>×</button>
                    </span>
                )}
            </span>
        </header>
    );
}
