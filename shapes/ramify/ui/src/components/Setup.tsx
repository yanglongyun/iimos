// 模型配置。没接上模型时关不掉 —— 不接模型,画布什么都长不出来。
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
        try { await onSave({ responsesUrl: url, apiKey: key, model, contextWindow: windowSize }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    };

    return (
        <div className="sheet" onMouseDown={(event) => { if (event.target === event.currentTarget && closable) onClose(); }}>
            <form className="setup" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                <div className="setup-head">
                    <h2>连接模型</h2>
                    {closable && <button type="button" className="x" aria-label="关闭" onClick={onClose}>✕</button>}
                </div>
                <p className="hint">任何兼容 OpenAI Responses 协议的服务都行,地址要填完整的端点(通常以 /responses 结尾)。key 只存在这台电脑上,所有 iimos 形态共用。</p>
                <label><span>服务地址</span>
                    <input ref={first} type="url" required autoComplete="off" spellCheck={false} placeholder="https://api.openai.com/v1/responses" value={url} onChange={(e) => setUrl(e.target.value)} />
                </label>
                <label><span>API Key</span>
                    <input ref={keyInput} type="password" autoComplete="off" required={!config?.hasKey}
                        placeholder={config?.hasKey ? config.keyHint : 'sk-…'} value={key} onChange={(e) => setKey(e.target.value)} />
                </label>
                <label><span>模型</span>
                    <input type="text" required autoComplete="off" spellCheck={false} placeholder="gpt-5" value={model} onChange={(e) => setModel(e.target.value)} />
                </label>
                <label><span>上下文窗口</span>
                    <input type="number" min={4000} step={1} required placeholder="128000" value={windowSize} onChange={(e) => setWindowSize(e.target.value)} />
                </label>
                {error && <p className="hint error">{error}</p>}
                <button type="submit" className="primary">连接</button>
            </form>
        </div>
    );
}
