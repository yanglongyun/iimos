// 开机横幅:字标 + 启动日志。初始状态下它在屏幕中间,提示符就在它下面;开口之后它留在会话顶上,像真终端一样。
import type { ReactNode } from 'react';
import type { Config, Workspace } from '../types';

const LOGO = `██╗██╗███╗   ███╗ ██████╗ ███████╗
██║██║████╗ ████║██╔═══██╗██╔════╝
██║██║██╔████╔██║██║   ██║███████╗
██║██║██║╚██╔╝██║██║   ██║╚════██║
██║██║██║ ╚═╝ ██║╚██████╔╝███████║
╚═╝╚═╝╚═╝     ╚═╝ ╚═════╝ ╚══════╝`;

const short = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function Banner({ workspace, config, onSetup, children }: {
    workspace: Workspace | null; config: Config | null; onSetup: () => void; children?: ReactNode;
}) {
    const ws = ['workspace 已就绪', workspace?.version && `v${workspace.version}`, workspace?.commit].filter(Boolean).join(' · ');
    return (
        <section className="fresh-view">
            <pre className="logo" aria-label="iimos">{LOGO}</pre>
            <div className="boot">
                <p className="ok">{ws}</p>
                {config?.ready
                    ? <p className="ok">模型已连接 · {config.model} · 上下文 {short(config.contextWindow)}</p>
                    : <p className="warn">模型未连接 —— <a onClick={onSetup}>先接上一个</a></p>}
            </div>
            {children && <div className="slot" id="fresh-slot">{children}</div>}
        </section>
    );
}
