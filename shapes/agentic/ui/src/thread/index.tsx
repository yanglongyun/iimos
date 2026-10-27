// 对话列:顶栏 + 消息流 + 输入区。
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Icon } from "../icons/Icon";
import { useShell } from "../shell/layout";
import { Composer } from "./Composer";
import { MessageStream } from "./MessageStream";
import { createDraft, openThread, threadTitle, useThread } from "./store";

export function ThreadView() {
  const shell = useShell();
  const { id } = useParams();
  useEffect(() => {
    if (id) {
      void openThread(id);
    } else {
      createDraft();
    }
  }, [id]);
  const { threads, currentId, messages, ready, loadError, online } = useThread();
  const title = currentId
    ? threadTitle(threads.find((item) => item.id === currentId)) || "对话"
    : "新对话";

  return (
    <section className={`thread${ready && !messages.length ? " is-blank" : ""}`}>
      <header className="topbar">
        <button
          className={`icon-btn menu-btn${shell.collapsed ? " show" : ""}`}
          title="展开侧栏"
          onClick={shell.toggleSidebar}
        >
          <Icon name="panel" size={17} />
        </button>
        <span className="topbar-title clip">{title}</span>
      </header>
      {!online && (
        <div className="connection-note">连接已断开，正在重连；已开始的任务会继续运行。</div>
      )}
      {loadError ? (
        <main className="route-error">
          <p>{loadError}</p>
          <button className="btn" onClick={() => id && void openThread(id, true)}>
            重试
          </button>
          <Link to="/">返回新对话</Link>
        </main>
      ) : (
        <>
          <MessageStream />
          <Composer />
        </>
      )}
    </section>
  );
}
