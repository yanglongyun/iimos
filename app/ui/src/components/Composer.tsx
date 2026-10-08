// 输入:一个 › 提示符。Enter 发送,Shift+Enter 换行;运行中出现停止按钮(Esc 同效)。
import { useEffect, useRef, useState } from 'react';

export function Composer({ running, onSend, onStop }: { running: boolean; onSend: (text: string) => Promise<boolean>; onStop: () => void }) {
    const [text, setText] = useState('');
    const input = useRef<HTMLTextAreaElement>(null);

    // 输入框在「屏幕中间」和「底部」之间挪位置时会重新挂载,挂上就把焦点给它。
    // 不用 autoFocus:它在 App 挂上 body 状态类之前就执行,那时提示符还藏着
    useEffect(() => { input.current?.focus(); }, []);
    // 像终端一样:点窗口里任何空白处,光标都回到提示符。点按钮、链接、展开工具行、选中文字时不抢
    useEffect(() => {
        const onUp = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('a, button, input, textarea, select, summary, label, .sheet')) return;
            if (!window.getSelection()?.isCollapsed) return;
            input.current?.focus();
        };
        document.addEventListener('mouseup', onUp);
        return () => document.removeEventListener('mouseup', onUp);
    }, []);
    // 高度跟着内容长,最多 200px
    useEffect(() => {
        const el = input.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }, [text]);

    const submit = async () => {
        const value = text.trim();
        if (!value || running) return;
        setText('');
        // 没发出去(比如没接模型)就把字还回来
        if (!(await onSend(value))) setText(value);
    };

    return (
        <form className="prompt" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <span className="caret">›</span>
            <textarea
                ref={input}
                rows={1}
                spellCheck={false}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void submit();
                    }
                }}
            />
            {running && (
                <button type="button" className="stop" title="停下(Esc)" aria-label="停下" onClick={onStop}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>
                </button>
            )}
        </form>
    );
}
