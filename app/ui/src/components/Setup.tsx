// 模型配置:一个小终端窗口。没接上模型时关不掉 —— 不接模型,这里什么都做不了。
import { useEffect, useRef, useState } from 'react';
import type { Config } from '../types';

export function Setup({ config, onSave, onClose }: {
    config: Config | null; onSave: (patch: Record<string, string>) => Promise<void>; onClose: () => void;
}) {
    const closable = Boolean(config?.ready);
    const [url, setUrl] = useState(config?.responsesUrl || '');
    const [key, setKey] = useState('');
    const [model, setModel] = useState(config?.model || '');
    const [windowSize, setWindowSize] = useState(String(config?.contextWindow || 128000));
    const [error, setError] = useState('');
    const first = useRef<HTMLInputElement>(null);
    const keyInput = useRef<HTMLInputElement>(null);

    useEffect(() => { (config?.responsesUrl ? keyInput : first).current?.focus(); }, []);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && closable) onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [closable, onClose]);

    const submit = async () => {
        setError('');
        try {
            await onSave({ responsesUrl: url, apiKey: key, model, contextWindow: windowSize });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
    };

    return (
        <div className="sheet" onMouseDown={(event) => { if (event.target === event.currentTarget && closable) onClose(); }}>
            <form className="setup" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                <div className="setup-bar">
                    <span>connect — 模型</span>
                    {closable && <button type="button" className="x" aria-label="关闭" onClick={onClose}>esc</button>}
                </div>
                <p className="hint">任何兼容 OpenAI Responses 协议的服务都行。key 只存在这台电脑上。</p>
                <label><span>服务地址 ›</span>
                    <input ref={first} type="url" required autoComplete="off" spellCheck={false} placeholder="https://api.openai.com/v1/responses" value={url} onChange={(e) => setUrl(e.target.value)} />
                </label>
                <label><span>API Key ›</span>
                    {/* 已存的 key 显示成头尾 + 中间打点;直接输入新的就是替换,不输入就不改 */}
                    <input ref={keyInput} type="password" autoComplete="off" required={!config?.hasKey}
                        className={config?.hasKey ? 'saved' : ''} placeholder={config?.hasKey ? config.keyHint : 'sk-…'}
                        value={key} onChange={(e) => setKey(e.target.value)} />
                </label>
                <label><span>模型   ›</span>
                    <input type="text" required autoComplete="off" spellCheck={false} placeholder="gpt-5" value={model} onChange={(e) => setModel(e.target.value)} />
                </label>
                <label><span>上下文 ›</span>
                    <input type="number" min={4000} step={1} required placeholder="128000" value={windowSize} onChange={(e) => setWindowSize(e.target.value)} /><em>token</em>
                </label>
                <p className="hint small">模型的上下文窗口。对话用到它的 70% 时,较早的部分会自动压缩成摘要。</p>
                {error && <p className="hint small" style={{ color: 'var(--bad)' }}>{error}</p>}
                <button type="submit" className="go">[ 连接 ↵ ]</button>
            </form>
        </div>
    );
}
