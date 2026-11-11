import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";

type Item = { id: string; text: string; done: boolean };
type Todos = { items: Item[]; version: string };
type Filter = "all" | "open" | "done";
type Failure = Error & { status?: number };

const TEXT_LIMIT = 200;
const FILTERS: { id: Filter; label: string; empty: string }[] = [
  { id: "all", label: "全部", empty: "还没有待办事项。在上面输入内容，按 Enter 添加。" },
  { id: "open", label: "未完成", empty: "没有未完成的事项。" },
  { id: "done", label: "已完成", empty: "还没有标记完成的事项。" },
];
const same = (a: Item[], b: Item[]) => JSON.stringify(a) === JSON.stringify(b);

/** 我的文档里的待办清单；每次改动立即写盘，版本过期时载入别处的新内容而不是覆盖。 */
export function Todo() {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("正在打开待办事项…");
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const stored = useRef<Todos | null>(null);
  const current = useRef<Item[]>([]);
  const saving = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let canceled = false;
    api<Todos>("GET", "/api/todos")
      .then((todos) => {
        if (canceled) return;
        stored.current = todos;
        current.current = todos.items;
        setItems(todos.items);
        setLoaded(true);
        setStatus("已保存");
      })
      .catch((cause) => {
        if (canceled) return;
        setError(true);
        setStatus((cause as Error).message);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const apply = useCallback((next: Item[]) => {
    current.current = next;
    setItems(next);
    setStatus("尚未保存");
    setError(false);
  }, []);

  const save = useCallback(async () => {
    if (saving.current) return saving.current;
    const task = async () => {
      const loaded = stored.current;
      if (!loaded || same(current.current, loaded.items)) return;
      setStatus("正在保存…");
      setError(false);
      try {
        while (
          stored.current &&
          !same(current.current, stored.current.items)
        ) {
          stored.current = await api<Todos>("POST", "/api/todos", {
            items: current.current,
            version: stored.current.version,
          });
        }
        setStatus("已保存");
      } catch (cause) {
        const failure = cause as Failure;
        if (failure.status === 409) {
          // 别处已经改过：显示那边的版本，不覆盖它的内容
          const latest = await api<Todos>("GET", "/api/todos").catch(
            () => null,
          );
          if (latest) {
            stored.current = latest;
            current.current = latest.items;
            setItems(latest.items);
            setEditing(null);
          }
          setStatus("待办已在其他窗口修改，已载入最新内容");
        } else setStatus(failure.message);
        setError(true);
      }
    };
    saving.current = task();
    await saving.current;
    saving.current = null;
  }, []);

  useEffect(() => {
    if (!loaded || !stored.current || same(items, stored.current.items)) return;
    const timer = setTimeout(() => {
      void save();
    }, 400);
    return () => clearTimeout(timer);
  }, [items, loaded, save]);

  useEffect(() => {
    const onExit = (event: BeforeUnloadEvent) => {
      if (stored.current && !same(current.current, stored.current.items))
        event.returnValue = "";
    };
    window.addEventListener("beforeunload", onExit);
    return () => window.removeEventListener("beforeunload", onExit);
  }, []);

  const reject = (message: string) => {
    setError(true);
    setStatus(message);
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    if (text.length > TEXT_LIMIT)
      return reject(`每条待办不能超过 ${TEXT_LIMIT} 个字符`);
    apply([{ id: crypto.randomUUID(), text, done: false }, ...items]);
    setDraft("");
    if (filter === "done") setFilter("open");
  };

  const toggle = (id: string) =>
    apply(
      items.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item,
      ),
    );

  const remove = (id: string) => {
    if (editing?.id === id) setEditing(null);
    apply(items.filter((item) => item.id !== id));
  };

  const commit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    const id = editing.id;
    setEditing(null);
    if (!text || text.length > TEXT_LIMIT) return;
    if (items.some((item) => item.id === id && item.text !== text))
      apply(items.map((item) => (item.id === id ? { ...item, text } : item)));
  };

  const visible = items.filter((item) =>
    filter === "all" ? true : filter === "done" ? item.done : !item.done,
  );
  const remaining = items.filter((item) => !item.done).length;
  const anyDone = items.some((item) => item.done);

  return (
    <div className="todo-app app-column">
      <nav className="menubar" aria-label="待办事项菜单">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
            {filter === entry.id ? "✓ " : ""}
            {entry.label}
          </button>
        ))}
        <button
          className="menubar-end"
          disabled={!loaded || !anyDone}
          onClick={() => apply(items.filter((item) => !item.done))}
        >
          清除已完成
        </button>
      </nav>
      <form
        className="todo-compose"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          aria-label="新待办内容"
          placeholder="输入待办内容，按 Enter 添加"
          maxLength={TEXT_LIMIT}
          disabled={!loaded}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="classic-button"
          disabled={!loaded || !draft.trim()}
        >
          <Icon name="save" size={16} />
          添加
        </button>
      </form>
      <div className="todo-list inset" role="list" aria-label="待办列表">
        {visible.length === 0 ? (
          <p className="todo-empty">
            {loaded
              ? FILTERS.find((entry) => entry.id === filter)?.empty
              : "正在打开待办事项…"}
          </p>
        ) : (
          visible.map((item) => (
            <div
              key={item.id}
              role="listitem"
              className={`todo-row ${item.done ? "done" : ""}`}
            >
              <button
                role="checkbox"
                aria-checked={item.done}
                aria-label={`${item.done ? "标记未完成" : "标记完成"}：${item.text}`}
                className="todo-check inset"
                onClick={() => toggle(item.id)}
              >
                {item.done ? "✓" : ""}
              </button>
              {editing?.id === item.id ? (
                <input
                  autoFocus
                  className="todo-edit"
                  aria-label="编辑待办内容"
                  maxLength={TEXT_LIMIT}
                  value={editing.text}
                  onChange={(event) =>
                    setEditing({ id: item.id, text: event.target.value })
                  }
                  onBlur={commit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commit();
                    } else if (event.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span
                  className="todo-text"
                  title="双击编辑"
                  onDoubleClick={() =>
                    setEditing({ id: item.id, text: item.text })
                  }
                >
                  {item.text}
                </span>
              )}
              <button
                className="todo-remove"
                title="删除"
                aria-label={`删除：${item.text}`}
                onClick={() => remove(item.id)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
      <footer className="statusbar">
        <span className={error ? "error-text" : ""} role="status">
          <Icon name="save" size={14} />
          {status}
        </span>
        <span>
          {remaining} / {items.length} 项未完成
        </span>
      </footer>
    </div>
  );
}
