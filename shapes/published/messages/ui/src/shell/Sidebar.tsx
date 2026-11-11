// 左栏:搜索框 + 新建对话,下面是对话列表(头像、标题、最后一句预览、时间)。
// 选中行蓝底白字;右键弹出 重命名 / 删除;正在回复的行头像角上亮一个点。底部是全局的设置入口。
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";

import { Avatar, Icon } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";
import { listTime } from "../thread/format";
import {
  createDraft,
  loadMoreThreads,
  removeThread,
  renameThread,
  search,
  threadTitle,
  useThread,
  type Thread,
} from "../thread/store";

interface Menu {
  thread: Thread;
  x: number;
  y: number;
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { threads, results, query, currentId, busy } = useThread();
  const list = results ?? threads;
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [renameText, setRenameText] = useState("");
  const [removing, setRemoving] = useState<Thread | null>(null);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };
    const onResize = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menu]);

  useEffect(() => {
    if (renaming) {
      setRenameText(renaming.title || renaming.subject);
    }
  }, [renaming]);

  const confirmRename = () => {
    const thread = renaming;
    setRenaming(null);
    if (!thread) {
      return;
    }
    const title = renameText.trim();
    if (title !== thread.title) {
      void renameThread(thread.id, title);
    }
  };

  // 菜单贴着鼠标位置弹出;靠近窗口右缘或底缘时往回让。
  const openMenu = (event: ReactMouseEvent, thread: Thread) => {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.min(event.clientX, window.innerWidth - 170);
    const y = Math.min(event.clientY, window.innerHeight - 96);
    setMenu({ thread, x, y });
  };

  const row = (thread: Thread) => {
    const live = thread.running || (thread.id === currentId && busy);
    const on = location.pathname === `/sessions/${thread.id}`;
    const title = threadTitle(thread);
    let preview = thread.preview;
    if (live) {
      preview = "正在输入…";
    } else if (thread.last_role === "user" && preview) {
      preview = `你：${preview}`;
    }
    return (
      <Link
        key={thread.id}
        to={`/sessions/${thread.id}`}
        className={`conv${on ? " on" : ""}${menu?.thread.id === thread.id ? " menu-open" : ""}`}
        draggable={false}
        onContextMenu={(event) => openMenu(event, thread)}
      >
        <span className="conv-avatar">
          <Avatar text={title} size={44} />
          {live && <span className="conv-live" title="正在回复" />}
        </span>
        <span className="conv-main">
          <span className="conv-top">
            <span className="conv-title clip">{title}</span>
            <span className="conv-time">{listTime(thread.updated_at)}</span>
          </span>
          <span className="conv-preview">{preview || "还没有消息"}</span>
        </span>
      </Link>
    );
  };

  return (
    <>
      <aside className="sidebar">
        <div className="side-head">
          <label className="search">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={query}
              placeholder="搜索"
              aria-label="搜索对话"
              onChange={(event) => search(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  search("");
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                aria-label="清除"
                onClick={() => search("")}
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </label>
          <Link
            to="/"
            className="icon-btn side-new"
            title="新建对话"
            onClick={() => {
              if (location.pathname === "/") {
                createDraft();
              }
            }}
          >
            <Icon name="compose" size={18} />
          </Link>
        </div>

        <div
          className="side-scroll"
          onScroll={(event) => {
            const element = event.currentTarget;
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) {
              void loadMoreThreads();
            }
          }}
        >
          {list.map(row)}
          {!list.length && (
            <div className="side-empty">{query ? "没有匹配的对话" : "还没有对话"}</div>
          )}
        </div>

        <div className="side-foot">
          <NavLink
            to="/settings"
            className={({ isActive }) => `side-settings${isActive ? " on" : ""}`}
          >
            <Icon name="settings" size={16} />
            <span>设置</span>
          </NavLink>
        </div>
      </aside>

      {menu && (
        <>
          <div
            className="conv-menu-veil"
            onClick={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }}
          />
          <div className="conv-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                setRenaming(menu.thread);
              }}
            >
              <Icon name="pen" size={14} />
              <span>重命名</span>
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenu(null);
                setRemoving(menu.thread);
              }}
            >
              <Icon name="trash" size={14} />
              <span>删除</span>
            </button>
          </div>
        </>
      )}

      {renaming && (
        <Sheet title="重命名" onClose={() => setRenaming(null)}>
          <input
            className="field-input"
            value={renameText}
            autoFocus
            onFocus={(event) => event.target.select()}
            placeholder="对话名称"
            onChange={(event) => setRenameText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                confirmRename();
              }
            }}
          />
          <div className="sheet-foot">
            <button className="btn btn-quiet" onClick={() => setRenaming(null)}>
              取消
            </button>
            <button className="btn btn-accent" onClick={confirmRename}>
              保存
            </button>
          </div>
        </Sheet>
      )}

      {removing && (
        <Sheet title="删除对话" onClose={() => setRemoving(null)}>
          <div className="sheet-note">
            「{threadTitle(removing)}」的全部消息会一并删除,不可恢复。
          </div>
          <div className="sheet-foot">
            <button className="btn btn-quiet" onClick={() => setRemoving(null)}>
              取消
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                const target = removing;
                setRemoving(null);
                const deleted = await removeThread(target.id);
                if (deleted && window.location.pathname === `/sessions/${target.id}`) {
                  navigate("/", { replace: true });
                }
              }}
            >
              删除
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
