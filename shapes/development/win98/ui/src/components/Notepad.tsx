import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";
type Note = { text: string; version: string };

export function Notepad() {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("正在打开便笺…");
  const [error, setError] = useState(false);
  const [wrap, setWrap] = useState(true);
  const current = useRef("");
  const stored = useRef<Note | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let canceled = false;
    api<Note>("GET", "/api/note")
      .then((note) => {
        if (canceled) return;
        stored.current = note;
        current.current = note.text;
        setText(note.text);
        setLoaded(true);
        setStatus("已保存");
      })
      .catch((cause) => {
        if (!canceled) {
          setError(true);
          setStatus(cause.message);
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  const save = useCallback(async () => {
    if (saving.current) return saving.current;
    if (!stored.current || current.current === stored.current.text) return;
    const task = async () => {
      setStatus("正在保存…");
      setError(false);
      try {
        while (stored.current && current.current !== stored.current.text) {
          stored.current = await api<Note>("POST", "/api/note", {
            text: current.current,
            version: stored.current.version,
          });
        }
        setStatus("已保存");
      } catch (cause) {
        setError(true);
        setStatus((cause as Error).message);
      }
    };
    saving.current = task();
    await saving.current;
    saving.current = null;
  }, []);

  useEffect(() => {
    if (!loaded || text === stored.current?.text) return;
    const timer = setTimeout(() => {
      void save();
    }, 700);
    return () => clearTimeout(timer);
  }, [text, loaded, save]);
  useEffect(() => {
    const onExit = (event: BeforeUnloadEvent) => {
      if (stored.current && current.current !== stored.current.text) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onExit);
    return () => window.removeEventListener("beforeunload", onExit);
  }, []);

  return (
    <div
      className="notepad-app app-column"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          void save();
        }
      }}
    >
      <nav className="menubar" aria-label="记事本菜单">
        <button
          onClick={() => {
            void save();
          }}
        >
          保存(<u>S</u>)
        </button>
        <button onClick={() => editor.current?.select()}>
          全选(<u>A</u>)
        </button>
        <button aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
          {wrap ? "✓ " : ""}自动换行(<u>W</u>)
        </button>
      </nav>
      <textarea
        ref={editor}
        className="notepad-editor inset"
        aria-label="便笺内容"
        disabled={!loaded}
        wrap={wrap ? "soft" : "off"}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          current.current = event.target.value;
          setText(event.target.value);
          setStatus("尚未保存");
          setError(false);
        }}
        placeholder="在这里记下点什么…"
      />
      <footer className="statusbar">
        <span className={error ? "error-text" : ""} role="status">
          <Icon name="save" size={14} />
          {status}
        </span>
        <span>{text.length.toLocaleString()} 字符</span>
      </footer>
    </div>
  );
}
