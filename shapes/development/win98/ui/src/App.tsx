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
import type { Rect, WindowId } from "./windowing";
import { Window } from "./components/Window";
import { Icon } from "./components/Icon";
import { Chat } from "./components/Chat";
import { Settings } from "./components/Settings";
import { Explorer } from "./components/Explorer";
import { Notepad } from "./components/Notepad";
import { Todo } from "./components/Todo";

const available = () => ({
  width: window.innerWidth,
  height: Math.max(200, window.innerHeight - 32),
});

export function App() {
  const [bounds, setBounds] = useState(available);
  const [desktop, setDesktop] = useState(() => initialDesktop(available()));
  const [startOpen, setStartOpen] = useState(false);
  const [selection, setSelection] = useState<WindowId | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const { state, send, stop, saveConfig, note } = useConversation();
  const startButton = useRef<HTMLButtonElement>(null);
  const startMenu = useRef<HTMLDivElement>(null);
  const open = useCallback((id: WindowId) => {
    setDesktop((value) => activate(value, id));
    setStartOpen(false);
  }, []);
  const close = useCallback((id: WindowId) => {
    setDesktop((value) => hideWindow(value, id, true));
  }, []);
  const minimize = useCallback((id: WindowId) => {
    setDesktop((value) => hideWindow(value, id, false));
  }, []);
  const maximize = (id: WindowId) => {
    setDesktop((value) => ({
      ...activate(value, id),
      windows: {
        ...value.windows,
        [id]: { ...value.windows[id], maximized: !value.windows[id].maximized },
      },
    }));
  };
  const setRect = (id: WindowId, rect: Rect) => {
    setDesktop((value) => ({
      ...value,
      windows: { ...value.windows, [id]: { ...value.windows[id], rect } },
    }));
  };

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
    window.addEventListener("resize", resize);
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => {
      window.removeEventListener("resize", resize);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !startMenu.current?.contains(event.target as Node) &&
        !startButton.current?.contains(event.target as Node)
      )
        setStartOpen(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && startOpen) {
        setStartOpen(false);
        startButton.current?.focus();
        event.preventDefault();
      }
      if (event.ctrlKey && event.key === "Escape") {
        setStartOpen((value) => !value);
        event.preventDefault();
      }
      if (event.altKey && event.key === "F4" && desktop.active) {
        close(desktop.active);
        event.preventDefault();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
    };
  }, [desktop.active, startOpen, close]);
  useEffect(() => {
    if (startOpen)
      startMenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [startOpen]);

  const onSend = useCallback(
    async (text: string) => {
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
    },
    [state.config, open, send, note],
  );
  const visible =
    desktop.windows.chat.open &&
    !desktop.windows.chat.minimized &&
    desktop.active === "chat";
  const content = (id: WindowId) => {
    switch (id) {
      case "chat":
        return (
          <Chat
            {...state}
            visible={visible}
            onSettings={() => open("settings")}
            onAbout={() => open("about")}
            onSend={onSend}
            onStop={stop}
          />
        );
      case "computer":
        return (
          <Explorer
            onNote={() => open("notepad")}
            onAbout={() => open("about")}
          />
        );
      case "todo":
        return <Todo />;
      case "notepad":
        return <Notepad />;
      case "settings":
        return <Settings config={state.config} onSave={saveConfig} />;
      case "about":
        return (
          <div className="about-app">
            <div className="about-banner">
              <Icon name="windows" size={64} />
              <span>
                iimos<b>98</b>
              </span>
            </div>
            <div className="about-body">
              <Icon name="computer" size={40} />
              <div>
                <b>iimos 98</b>
                <p>版本 1.0</p>
                <p>
                  一个可以修改自己的桌面。
                  <br />
                  代码和数据保存在本机。
                </p>
                <hr />
                <p>基于 iimos · Windows 98 经典风格</p>
              </div>
            </div>
            <div className="about-actions">
              <button className="classic-button" onClick={() => close("about")}>
                确定
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <main
      className="desktop"
      aria-label="iimos 98 桌面"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="desktop-surface"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setSelection(null);
            setDesktop((value) => ({ ...value, active: null }));
          }
        }}
      >
        <div className="desktop-icons">
          {(
            ["computer", "chat", "todo", "notepad", "settings"] as WindowId[]
          ).map(
            (id) => (
              <button
                key={id}
                className={`desktop-shortcut ${selection === id ? "selected" : ""}`}
                onClick={() => {
                  setSelection(id);
                  setDesktop((value) => ({ ...value, active: null }));
                }}
                onDoubleClick={() => open(id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open(id);
                }}
                title={`打开${APPS[id].name}`}
              >
                <Icon name={id} />
                <span>{APPS[id].name}</span>
              </button>
            ),
          )}
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
            {content(id)}
          </Window>
        ))}
      </div>
      {startOpen && (
        <div
          className="start-menu outset"
          ref={startMenu}
          role="menu"
          aria-label="开始菜单"
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button",
              ),
            ];
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            buttons[
              (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                buttons.length) %
                buttons.length
            ]?.focus();
          }}
        >
          <div className="start-rail">
            <span>
              iimos<b>98</b>
            </span>
          </div>
          <div className="start-items">
            <div className="start-heading">iimos 98</div>
            {(["chat", "computer", "todo", "notepad"] as WindowId[]).map((id) => (
              <button key={id} role="menuitem" onClick={() => open(id)}>
                <Icon name={id} />
                <span>{APPS[id].name}</span>
              </button>
            ))}
            <hr />
            <button role="menuitem" onClick={() => open("settings")}>
              <Icon name="settings" />
              <span>控制面板</span>
            </button>
            <button role="menuitem" onClick={() => open("about")}>
              <Icon name="about" />
              <span>关于 iimos 98</span>
            </button>
          </div>
        </div>
      )}
      <footer className="taskbar">
        <button
          ref={startButton}
          className={`start-button classic-button ${startOpen ? "pressed" : ""}`}
          onClick={() => setStartOpen((value) => !value)}
          aria-expanded={startOpen}
          aria-haspopup="menu"
        >
          <Icon name="windows" size={22} />
          <b>开始</b>
        </button>
        <div className="taskbar-separator" />
        <div className="quick-launch">
          <button
            title="打开 iimos 助手"
            aria-label="打开 iimos 助手"
            onClick={() => open("chat")}
          >
            <Icon name="chat" size={18} />
          </button>
          <button
            title="显示桌面"
            aria-label="显示桌面"
            onClick={() => {
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
            }}
          >
            <Icon name="computer" size={18} />
          </button>
        </div>
        <div className="taskbar-separator" />
        <div className="task-buttons">
          {desktop.tasks.map((id) => (
            <button
              key={id}
              className={`task-button classic-button ${desktop.active === id && !desktop.windows[id].minimized ? "pressed" : ""}`}
              onClick={() => {
                if (desktop.active === id && !desktop.windows[id].minimized)
                  minimize(id);
                else open(id);
              }}
              title={APPS[id].name}
            >
              <Icon name={id} size={16} />
              <span>{APPS[id].name}</span>
              {id === "chat" && state.running && (
                <span className="task-running">●</span>
              )}
            </button>
          ))}
        </div>
        <div className="system-tray inset">
          <span
            title={state.config?.ready ? "模型已配置" : "尚未配置模型"}
            className={`tray-status ${state.config?.ready ? "connected" : ""}`}
          />
          <time
            title={clock.toLocaleDateString("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          >
            {clock.toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </time>
        </div>
      </footer>
    </main>
  );
}
