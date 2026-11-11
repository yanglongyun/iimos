// 右栏:顶栏(头像 + 标题 + 模型)+ 消息流 + 输入区。
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Avatar } from "../icons/Icon";
import { Composer } from "./Composer";
import { MessageStream } from "./MessageStream";
import { createDraft, openThread, threadTitle, useThread } from "./store";

export function ThreadView() {
  const { id } = useParams();
  useEffect(() => {
    if (id) {
      void openThread(id);
    } else {
      createDraft();
    }
  }, [id]);
  const { threads, currentId, loadError, online, status } = useThread();
  const thread = threads.find((item) => item.id === currentId);
  const title = currentId ? threadTitle(thread) : "新对话";

  return (
    <section className="thread">
      <header className="topbar">
        <div className="topbar-who">
          <Avatar text={title} size={30} agent={!currentId} />
          <span className="topbar-title clip">{title}</span>
          {status?.model && <span className="topbar-model clip">{status.model}</span>}
        </div>
      </header>
      {!online && (
        <div className="connection-note">连接已断开，正在重连；已开始的任务会继续运行。</div>
      )}
      {loadError ? (
        <main className="route-error">
          <p>{loadError}</p>
          <button className="btn btn-quiet" onClick={() => id && void openThread(id, true)}>
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
