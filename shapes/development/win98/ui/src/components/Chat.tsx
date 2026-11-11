import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { markdown } from "../markdown";
import type { Config, Item } from "../types";
import { Icon } from "./Icon";

function Call({
  item,
  output,
}: {
  item: Extract<Item, { type: "function_call" }>;
  output?: string;
}) {
  let command = item.arguments;
  try {
    command = JSON.parse(item.arguments).command || item.arguments;
  } catch {
    /* 模型参数原样展示。 */
  }
  let result;
  try {
    result = output ? JSON.parse(output) : null;
  } catch {
    result = { text: output, success: false };
  }
  return (
    <details
      className={`tool-call ${result?.success === false ? "failed" : ""}`}
    >
      <summary>
        <span className="tool-mark">{result ? "■" : "▸"}</span>
        <span>{command.split("\n")[0]}</span>
        <small>{result ? "已完成" : "执行中"}</small>
      </summary>
      <pre>
        {command}
        {result ? `\n\n${result.text}` : ""}
      </pre>
    </details>
  );
}

type Props = {
  items: Item[];
  partial: string;
  running: boolean;
  config: Config | null;
  tokens: number;
  visible: boolean;
  onSettings: () => void;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onAbout: () => void;
};
export function Chat({
  items,
  partial,
  running,
  config,
  tokens,
  visible,
  onSettings,
  onSend,
  onStop,
  onAbout,
}: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const outputs = new Map<string, string>();
  for (const item of items)
    if (item.type === "function_call_output")
      outputs.set(item.call_id, item.output);
  useLayoutEffect(() => {
    if (follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [items, partial, visible]);
  useEffect(() => {
    if (visible) input.current?.focus();
  }, [visible]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    follow.current = true;
    if (!(await onSend(text))) setDraft(text);
    input.current?.focus();
  };
  return (
    <div className="chat-app app-column">
      <nav className="menubar" aria-label="助手菜单">
        <button onClick={() => input.current?.focus()}>
          对话(<u>C</u>)
        </button>
        <button onClick={onSettings}>
          设置(<u>S</u>)
        </button>
        <button onClick={onAbout}>
          帮助(<u>H</u>)
        </button>
      </nav>
      <div className="chat-toolbar">
        <Icon name="chat" size={24} />
        <div>
          <b>iimos 助手</b>
          <span>{config?.ready ? config.model : "尚未连接模型"}</span>
        </div>
        <button className="classic-button" onClick={onSettings}>
          模型设置
        </button>
      </div>
      <div
        className="chat-history inset"
        ref={scroller}
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          const target = event.currentTarget;
          follow.current =
            target.scrollHeight - target.scrollTop - target.clientHeight < 70;
        }}
      >
        <div className="chat-welcome">
          <Icon name="computer" size={40} />
          <div>
            <h1>欢迎使用 iimos 98</h1>
            <p>从一句话开始，改造你的桌面。</p>
          </div>
        </div>
        {!items.length && (
          <div className="chat-intro">
            <p>
              我是这个桌面里的本地助手。你可以让我处理文件、执行任务，或修改这个桌面。
            </p>
            <div className="suggestions">
              {[
                "在桌面上加一个待办列表",
                "看看这个应用的源码结构",
                "给我写一份今天的工作计划",
              ].map((text) => (
                <button
                  key={text}
                  onClick={() => {
                    setDraft(text);
                    input.current?.focus();
                  }}
                >
                  <span>›</span>
                  {text}
                </button>
              ))}
            </div>
            <p className="connection-note">
              <Icon name="settings" size={16} />
              {config?.ready
                ? "模型已连接，可以开始对话。"
                : "首次使用，请在控制面板中配置模型。"}
              {!config?.ready && (
                <button className="text-link" onClick={onSettings}>
                  打开控制面板
                </button>
              )}
            </p>
          </div>
        )}
        {items.map((item, index) => {
          switch (item.type) {
            case "message": {
              const text = item.content.map((part) => part.text || "").join("");
              if (!text.trim()) return null;
              return (
                <article key={index} className={`chat-message ${item.role}`}>
                  <div className="message-author">
                    {item.role === "user" ? "你" : "iimos 助手"}
                  </div>
                  {item.role === "user" ? (
                    <p className="user-text">{text}</p>
                  ) : (
                    <div
                      className="markdown"
                      dangerouslySetInnerHTML={{ __html: markdown(text) }}
                    />
                  )}
                </article>
              );
            }
            case "function_call":
              return (
                <Call
                  key={index}
                  item={item}
                  output={outputs.get(item.call_id)}
                />
              );
            case "compaction":
              return (
                <details key={index} className="system-entry">
                  <summary>已压缩 {item.covered} 条历史消息</summary>
                  <pre>{item.summary}</pre>
                </details>
              );
            case "restart":
              return (
                <p key={index} className="system-entry">
                  {item.stopped ? "已暂停自动接续" : "应用已重启，对话已接续"}
                </p>
              );
            case "local":
              return (
                <p
                  key={index}
                  className={`system-entry ${item.kind === "error" ? "error-text" : ""}`}
                >
                  {item.text}
                </p>
              );
            default:
              return null;
          }
        })}
        {running && (
          <article className="chat-message assistant">
            <div className="message-author">iimos 助手</div>
            {partial ? (
              <div
                className="markdown"
                dangerouslySetInnerHTML={{ __html: markdown(partial) }}
              />
            ) : (
              <p className="working">
                正在处理<span>…</span>
              </p>
            )}
          </article>
        )}
      </div>
      <form
        className="chat-compose"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <textarea
          ref={input}
          aria-label="发送给助手的消息"
          placeholder="在这里输入消息…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
            if (event.key === "Escape" && running) onStop();
          }}
        />
        <div className="compose-actions">
          <span>Enter 发送 · Shift+Enter 换行</span>
          {running ? (
            <button type="button" className="classic-button" onClick={onStop}>
              停止
            </button>
          ) : (
            <button
              type="submit"
              className="classic-button"
              disabled={!draft.trim()}
            >
              发送(<u>S</u>)
            </button>
          )}
        </div>
      </form>
      <footer className="statusbar">
        <span>{running ? "正在处理…" : "就绪"}</span>
        <span>{tokens ? `${tokens.toLocaleString()} token` : "本地对话"}</span>
      </footer>
    </div>
  );
}
