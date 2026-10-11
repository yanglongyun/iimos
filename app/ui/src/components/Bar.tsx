// 顶栏:无框窗口下整条可拖窗口。右边是上下文用量、当前模型(点开模型配置)和窗口钮(macOS 用原生红绿灯,不画)。
import type { Config } from '../types';

const HAS_WINDOW_BUTTONS = /Win|Linux/.test(navigator.userAgent);

export function Bar({ config, tokens, onModel }: { config: Config | null; tokens: number; onModel: () => void }) {
    const pct = config?.contextWindow ? Math.round((tokens / config.contextWindow) * 100) : 0;
    return (
        <header className="bar">
            <span className="where"><b>iimos</b> ~/workspace</span>
            <span className="right">
                {/* 到 70% 会自动压缩,快到时标黄 */}
                <span className={`ctx${pct >= 60 ? ' high' : ''}`} title="上下文用量:到 70% 自动压缩">{tokens ? `ctx ${pct}%` : ''}</span>
                <button className={`model${config?.ready ? ' on' : ''}`} type="button" title="模型设置" onClick={onModel}>
                    {config?.ready ? config.model : '未连接'}
                </button>
                {HAS_WINDOW_BUTTONS && (
                    <span className="winbtns">
                        <button type="button" title="最小化" onClick={() => window.iimosWin?.minimize()}>─</button>
                        <button type="button" title="最大化 / 还原" onClick={() => window.iimosWin?.toggleMaximize()}>□</button>
                        <button type="button" className="close" title="关闭" onClick={() => window.iimosWin?.close()}>×</button>
                    </span>
                )}
            </span>
        </header>
    );
}
