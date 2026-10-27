// 左侧栏,自上而下:品牌行 · 新对话 · 置顶 · 最近对话 · 底部(设置)。
// 行悬停露出「更多」按钮,点开是置顶 / 重命名 / 删除;正在跑的行画呼吸点。置顶组内可拖拽排序。
import { useEffect, useState, type CSSProperties } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";

import { Icon, Mark } from "../icons/Icon";
import { Sheet } from "../overlay/Sheet";
import { useShell } from "./layout";
import { Resizer } from "./Resizer";
import {
  createDraft,
  loadMoreThreads,
  pinThread,
  removeThread,
  renameThread,
  reorderPins,
  threadTitle,
  useThread,
  type Thread,
} from "../thread/store";

export function Sidebar() {
  const shell = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const { threads, pinOrder, currentId, busy } = useThread();
  const [renaming, setRenaming] = useState<Thread | null>(null);
  // 置顶组拖拽：正在拖的行，以及它将落在哪一行的上方或下方。
  const [dragging, setDragging] = useState("");
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const pinned = pinOrder
    .map((id) => threads.find((thread) => thread.id === id))
    .filter((thread): thread is Thread => Boolean(thread));
  const recent = threads.filter((thread) => !pinOrder.includes(thread.id));
  const [renameText, setRenameText] = useState("");
  const [removing, setRemoving] = useState<Thread | null>(null);
  // 「更多」菜单固定定位在按钮旁，不受列表滚动区域裁切；靠近窗口底部时向上弹出。
  const [menu, setMenu] = useState<{
    thread: Thread;
    pinned: boolean;
    x: number;
    y: number;
    up: boolean;
  } | null>(null);

  useEffect(() => {
    if (!menu) {
      return;
    }
    // 按 Esc 或窗口尺寸变化（菜单位置会失准）时关闭。
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
      setRenameText(threadTitle(renaming));
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

  const finishDrag = () => {
    if (dragging && drop && dragging !== drop.id) {
      const ids = pinOrder.filter((id) => id !== dragging);
      let index = ids.indexOf(drop.id);
      if (drop.after) {
        index++;
      }
      ids.splice(index, 0, dragging);
      void reorderPins(ids);
    }
    setDragging("");
    setDrop(null);
  };

  const row = (thread: Thread, isPinned: boolean) => {
    const live = thread.running || (thread.id === currentId && busy);
    let className = "conv";
    if (location.pathname === `/sessions/${thread.id}`) {
      className += " on";
    }
    if (dragging === thread.id) {
      className += " dragging";
    }
    if (menu?.thread.id === thread.id) {
      className += " menu-open";
    }
    if (drop?.id === thread.id && dragging !== thread.id) {
      className += drop.after ? " drop-after" : " drop-before";
    }
    return (
      <div
        key={thread.id}
        className={className}
        draggable={isPinned}
        onDragStart={(event) => {
          if (!isPinned) {
            return;
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", thread.id);
          setDragging(thread.id);
        }}
        onDragOver={(event) => {
          if (!isPinned || !dragging) {
            return;
          }
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          setDrop({ id: thread.id, after: event.clientY > box.top + box.height / 2 });
        }}
        onDrop={(event) => {
          event.preventDefault();
          finishDrag();
        }}
        onDragEnd={() => {
          setDragging("");
          setDrop(null);
        }}
      >
        {live && <span className="conv-live" title="正在运行" />}
        <Link className="conv-title clip" to={`/sessions/${thread.id}`} draggable={false}>
          {threadTitle(thread)}
        </Link>
        <span className="conv-ops" onClick={(event) => event.stopPropagation()}>
          <button
            className="op"
            title="更多"
            aria-haspopup="menu"
            aria-expanded={menu?.thread.id === thread.id}
            onClick={(event) => {
              // 按整行定位：按钮平时隐藏，行的位置始终可靠。
              const row = event.currentTarget.closest(".conv") as HTMLElement;
              const box = row.getBoundingClientRect();
              const up = box.bottom + 130 > window.innerHeight;
              setMenu({
                thread,
                pinned: isPinned,
                x: box.right,
                y: up ? box.top - 4 : box.bottom + 4,
                up,
              });
            }}
          >
            <Icon name="more" size={15} />
          </button>
        </span>
      </div>
    );
  };

  return (
    <>
      <aside
        className={`sidebar${shell.collapsed ? " folded" : ""}`}
        style={{ "--sidebar-width": `${shell.sidebarWidth}px` } as CSSProperties}
      >
        <Resizer />
        <div className="side-head">
          <Mark size={24} />
          <span className="side-brand">agentic</span>
          <span className="grow" />
          <button className="icon-btn" title="收起侧栏" onClick={shell.toggleSidebar}>
            <Icon name="panel" size={16} />
          </button>
        </div>

        {/* 新对话是动作不是清单的一行,恒在顶部,不进滚动区 */}
        <Link
          to="/"
          className="side-new"
          onClick={() => {
            if (location.pathname === "/") {
              createDraft();
            }
          }}
        >
          <Icon name="compose" size={16} />
          <span>新对话</span>
        </Link>

        <div
          className="side-scroll"
          onScroll={(event) => {
            const element = event.currentTarget;
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) {
              void loadMoreThreads();
            }
          }}
        >
          {pinned.length > 0 && (
            <>
              <div className="side-label">置顶</div>
              {pinned.map((thread) => row(thread, true))}
            </>
          )}
          {recent.length > 0 && (
            <>
              <div className="side-label">最近</div>
              {recent.map((thread) => row(thread, false))}
            </>
          )}
          {!threads.length && <div className="side-empty">还没有对话</div>}
        </div>

        <div className="side-foot">
          <NavLink
            to="/settings"
            className={({ isActive }) => `side-settings${isActive ? " on" : ""}`}
          >
            <Icon name="settings" size={15} />
            <span>设置</span>
          </NavLink>
        </div>
      </aside>

      {menu && (
        <>
          <div className="conv-menu-veil" onClick={() => setMenu(null)} />
          <div
            className={`conv-menu${menu.up ? " up" : ""}`}
            role="menu"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                void pinThread(menu.thread.id, !menu.pinned);
              }}
            >
              <Icon name="pin" size={14} />
              <span>{menu.pinned ? "取消置顶" : "置顶"}</span>
            </button>
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
            placeholder="对话标题"
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
        <Sheet title="删除" onClose={() => setRemoving(null)}>
          <div className="sheet-note">
            「{threadTitle(removing)}
            」的全部消息和压缩记录会一并删除,不可恢复。
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
