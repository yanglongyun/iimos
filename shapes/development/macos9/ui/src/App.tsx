import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "./store";
import {
  activate,
  APPS,
  fit,
  hideWindow,
  initialDesktop,
  WINDOW_IDS,
} from "./windowing";
import type { WindowId, Rect } from "./windowing";
import { Window } from "./components/Window";
import { Icon } from "./components/Icon";
import { Chat } from "./components/Chat";
import { Explorer } from "./components/Explorer";
import { Notepad } from "./components/Notepad";
import { Settings } from "./components/Settings";
import { Todo } from "./components/Todo";
const available = () => ({
  width: innerWidth,
  height: Math.max(200, innerHeight - 29),
});
const names: Record<WindowId, string> = {
  chat: "iimos 助手",
  computer: "Finder",
  notepad: "便笺",
  todo: "待办事项",
  settings: "控制面板",
  about: "关于这台电脑",
};

export function App() {
  const [bounds, setBounds] = useState(available);
  const [desktop, setDesktop] = useState(() => initialDesktop(available()));
  const [menu, setMenu] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [selected, setSelected] = useState<WindowId | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { state, send, stop, saveConfig, note } = useConversation();
  const open = useCallback((id: WindowId) => {
    setDesktop((value) => activate(value, id));
    setMenu(null);
  }, []);
  const close = (id: WindowId) =>
    setDesktop((value) => hideWindow(value, id, true));
  const minimize = (id: WindowId) =>
    setDesktop((value) => hideWindow(value, id, false));
  const maximize = (id: WindowId) =>
    setDesktop((value) => ({
      ...activate(value, id),
      windows: {
        ...value.windows,
        [id]: { ...value.windows[id], maximized: !value.windows[id].maximized },
      },
    }));
  const setRect = (id: WindowId, rect: Rect) =>
    setDesktop((value) => ({
      ...value,
      windows: { ...value.windows, [id]: { ...value.windows[id], rect } },
    }));
  useEffect(() => {
    const resize = () => {
      const next = available();
      setBounds(next);
      setDesktop((value) => ({
        ...value,
        windows: Object.fromEntries(
          WINDOW_IDS.map((id) => [
            id,
            { ...value.windows[id], rect: fit(value.windows[id].rect, next) },
          ]),
        ) as typeof value.windows,
      }));
    };
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const timer = setInterval(() => setClock(new Date()), 1000);
    addEventListener("resize", resize);
    document.addEventListener("pointerdown", outside);
    return () => {
      clearInterval(timer);
      removeEventListener("resize", resize);
      document.removeEventListener("pointerdown", outside);
    };
  }, []);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "w" &&
        desktop.active
      ) {
        event.preventDefault();
        close(desktop.active);
      }
    };
    addEventListener("keydown", keys);
    return () => removeEventListener("keydown", keys);
  }, [desktop.active]);
  const onSend = async (text: string) => {
    if (!state.config?.ready) {
      open("settings");
      return false;
    }
    try {
      await send(text);
      return true;
    } catch (cause) {
      note("error", (cause as Error).message);
      return false;
    }
  };
  const active = desktop.active ? names[desktop.active] : "Finder";
  const menuItems: Record<
    string,
    { label: string; run: () => void; shortcut?: string }[]
  > = {
    apple: [
      { label: "关于这台电脑…", run: () => open("about") },
      { label: "控制面板", run: () => open("settings") },
      { label: "便笺", run: () => open("notepad") },
      { label: "待办事项", run: () => open("todo") },
    ],
    file: [
      { label: "打开 Macintosh HD", run: () => open("computer") },
      { label: "打开助手", run: () => open("chat") },
      { label: "打开便笺", run: () => open("notepad") },
      {
        label: "关闭窗口",
        run: () => {
          if (desktop.active) close(desktop.active);
          setMenu(null);
        },
        shortcut: "⌘W",
      },
    ],
    windows: desktop.tasks.map((id) => ({
      label: `${desktop.active === id ? "✓ " : ""}${names[id]}`,
      run: () => open(id),
    })),
    special: [
      {
        label: "显示桌面",
        run: () => {
          setDesktop((value) => ({
            ...value,
            active: null,
            windows: Object.fromEntries(
              WINDOW_IDS.map((id) => [
                id,
                {
                  ...value.windows[id],
                  minimized:
                    value.windows[id].open || value.windows[id].minimized,
                },
              ]),
            ) as typeof value.windows,
          }));
          setMenu(null);
        },
      },
      { label: "恢复助手", run: () => open("chat") },
    ],
    help: [
      { label: "关于 iimos 9", run: () => open("about") },
      { label: "模型连接设置", run: () => open("settings") },
    ],
  };
  return (
    <main
      className="desktop mac-desktop"
      aria-label="iimos 9 桌面"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="mac-menu" ref={menuRef}>
        <div className="mac-menu-left">
          {[
            ["apple", "◆"],
            ["file", "文件"],
            ["windows", "窗口"],
            ["special", "特殊"],
            ["help", "帮助"],
          ].map(([id, label]) => (
            <div className="mac-menu-group" key={id}>
              <button
                aria-label={id === "apple" ? "苹果菜单" : label}
                aria-expanded={menu === id}
                className={`${id === "apple" ? "apple-button" : ""} ${menu === id ? "menu-selected" : ""}`}
                onClick={() => setMenu(menu === id ? null : id)}
              >
                {id === "apple" ? (
                  <svg
                    viewBox="0 0 32 32"
                    width="20"
                    height="20"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient
                        id="apple-rainbow"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor="#62b34b" />
                        <stop offset="31%" stopColor="#62b34b" />
                        <stop offset="31%" stopColor="#efd039" />
                        <stop offset="45%" stopColor="#efd039" />
                        <stop offset="45%" stopColor="#e99b37" />
                        <stop offset="58%" stopColor="#e99b37" />
                        <stop offset="58%" stopColor="#d85247" />
                        <stop offset="72%" stopColor="#d85247" />
                        <stop offset="72%" stopColor="#945ca1" />
                        <stop offset="85%" stopColor="#945ca1" />
                        <stop offset="85%" stopColor="#5189b2" />
                      </linearGradient>
                    </defs>
                    <path
                      fill="url(#apple-rainbow)"
                      d="M16 9C12 5 5 6 4 13c-1 7 4 16 8 16 3 0 3-3 7-1 4 3 8-5 9-8-6-2-6-8-1-10-3-4-7-4-11-1ZM16 8c0-5 4-7 8-7 0 4-4 7-8 7Z"
                    />
                  </svg>
                ) : (
                  label
                )}
              </button>
              {menu === id && (
                <div role="menu" className="mac-dropdown">
                  {menuItems[id].length ? (
                    menuItems[id].map((item) => (
                      <button
                        role="menuitem"
                        key={item.label}
                        onClick={item.run}
                      >
                        <span>{item.label}</span>
                        <span>{item.shortcut}</span>
                      </button>
                    ))
                  ) : (
                    <span className="mac-menu-empty">没有打开的窗口</span>
                  )}
                </div>
              )}
            </div>
          ))}
          <b className="mac-active-app">{active}</b>
        </div>
        <div className="mac-menu-right">
          <time>
            {clock.toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </time>
          <button
            className={menu === "apps" ? "menu-selected" : ""}
            onClick={() => setMenu(menu === "apps" ? null : "apps")}
            aria-label="切换应用"
          >
            <Icon name={desktop.active || "computer"} size={16} />
            <b>{active}</b>
            <span>▾</span>
          </button>
          {menu === "apps" && (
            <div className="mac-dropdown app-dropdown" role="menu">
              {desktop.tasks.map((id) => (
                <button role="menuitem" key={id} onClick={() => open(id)}>
                  <Icon name={id} size={16} />
                  {names[id]}
                </button>
              ))}
              <hr />
              <button role="menuitem" onClick={() => open("chat")}>
                打开 iimos 助手
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        className="desktop-surface"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelected(null);
            setDesktop((value) => ({ ...value, active: null }));
          }
        }}
      >
        <div className="mac-icons">
          {(["computer", "chat", "notepad", "todo"] as WindowId[]).map((id) => (
            <button
              className={`desktop-shortcut ${selected === id ? "selected" : ""}`}
              key={id}
              onClick={() => {
                setSelected(id);
                setDesktop((value) => ({ ...value, active: null }));
              }}
              onDoubleClick={() => open(id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") open(id);
              }}
            >
              <Icon name={id} />
              <span>{id === "computer" ? "Macintosh HD" : names[id]}</span>
            </button>
          ))}
        </div>
        {WINDOW_IDS.map((id) => (
          <Window
            key={id}
            id={id}
            state={desktop.windows[id]}
            active={desktop.active === id}
            bounds={bounds}
            zIndex={10 + desktop.order.indexOf(id)}
            onFocus={() =>
              setDesktop((value) =>
                value.active === id ? value : activate(value, id),
              )
            }
            onRect={(rect) => setRect(id, rect)}
            onClose={() => close(id)}
            onMinimize={() => minimize(id)}
            onMaximize={() => maximize(id)}
          >
            {id === "chat" ? (
              <Chat
                {...state}
                visible={desktop.active === "chat"}
                onSettings={() => open("settings")}
                onAbout={() => open("about")}
                onSend={onSend}
                onStop={stop}
              />
            ) : id === "computer" ? (
              <Explorer
                onNote={() => open("notepad")}
                onAbout={() => open("about")}
              />
            ) : id === "notepad" ? (
              <Notepad />
            ) : id === "todo" ? (
              <Todo />
            ) : id === "settings" ? (
              <Settings config={state.config} onSave={saveConfig} />
            ) : (
              <div className="mac-about">
                <div className="happy-mac">
                  <Icon name="computer" size={64} />
                </div>
                <h1>Mac OS 9</h1>
                <p>iimos 9 · 版本 1.0</p>
                <hr />
                <p>一个可以修改自己的本地桌面。</p>
                <dl>
                  <dt>系统</dt>
                  <dd>iimos 9</dd>
                  <dt>模型</dt>
                  <dd>{state.config?.model || "尚未配置"}</dd>
                  <dt>应用</dt>
                  <dd>助手、Finder、便笺、待办事项</dd>
                </dl>
                <button
                  className="classic-button"
                  onClick={() => close("about")}
                >
                  好
                </button>
              </div>
            )}
          </Window>
        ))}
      </div>
      <div className="mac-control-strip">
        <button aria-label="打开控制面板" onClick={() => open("settings")}>
          ◀
        </button>
        <span>◈</span>
        <button aria-label="打开 iimos 助手" onClick={() => open("chat")}>
          <Icon name="chat" size={16} />
        </button>
        <button aria-label="打开便笺" onClick={() => open("notepad")}>
          <Icon name="notepad" size={16} />
        </button>
        <span
          className="strip-lamp"
          title={state.config?.ready ? "模型已配置" : "尚未配置模型"}
        />
        <span className="strip-grip" />
      </div>
    </main>
  );
}
