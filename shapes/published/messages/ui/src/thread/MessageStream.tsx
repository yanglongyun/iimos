// 消息流:用户蓝气泡靠右,agent 灰气泡靠左(流式时边收边长),思考 / 工具各折成一行排在左侧。
// 同一人连发的气泡挨得更近,最后一条带小尾巴;换天或隔开 15 分钟以上插一条时间标签。
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";

import { Icon } from "../icons/Icon";
import { copyText } from "../lib/clipboard";
import { ThinkStep, ToolStep, Typing } from "./Steps";
import { renderMd, stampLabel } from "./format";
import { loadOlder, retrySend, useThread } from "./store";
import { buildRows, type Row } from "./thread";

type Block =
  | { kind: "stamp"; key: string; label: string }
  | { kind: "row"; key: string; row: Row; tail: boolean };

const GAP = 15 * 60 * 1000;

export function MessageStream() {
  const navigate = useNavigate();
  const showCreatedSession = (id: string) => {
    if (window.location.pathname === "/") {
      navigate(`/sessions/${id}`, { replace: true });
    }
  };
  const { messages, compactions, notes, busy, ready, hasMore, loadingOlder, viewSeq, currentId } =
    useThread();
  const rows = useMemo(
    () => [...buildRows(messages, compactions, busy), ...notes],
    [messages, compactions, busy, notes],
  );
  const scrollRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // 「粘底」:贴着底部时任何高度变化都跟着走;用户上滚就不打扰,滚回底部重新粘上
  const stick = useRef(true);
  const restoreFromTop = useRef(0);

  const blocks = useMemo<Block[]>(() => {
    const output: Block[] = [];
    let lastAt = 0;
    const side = (row: Row) => (row.kind === "user" ? "me" : row.kind === "system" ? "" : "them");
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row.at && row.at - lastAt > GAP) {
        output.push({ kind: "stamp", key: `stamp:${row.key}`, label: stampLabel(row.at) });
      }
      if (row.at) {
        lastAt = row.at;
      }
      // 尾巴:这条之后换人了,或者间隔够久,或者已经是最后一条
      const next = rows[index + 1];
      const tail =
        !next || side(next) !== side(row) || Boolean(next.at && row.at && next.at - row.at > GAP);
      output.push({ kind: "row", key: row.key, row, tail });
    }
    return output;
  }, [rows]);

  // 正文还没开始流出来时显示「正在输入」的三个点
  const showTyping = useMemo(() => {
    if (!busy) {
      return false;
    }
    const last = rows[rows.length - 1];
    if (last && last.kind === "assistant" && last.streaming && last.content) {
      return false;
    }
    return true;
  }, [busy, rows]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (element.scrollTop < 60 && hasMore && !loadingOlder) {
      restoreFromTop.current = element.scrollHeight;
      void loadOlder();
    }
  };

  // 依赖 currentId:内层容器按对话 key 重挂,换对话后要观察的是新节点
  useEffect(() => {
    const element = scrollRef.current;
    const inner = innerRef.current;
    if (!element || !inner) {
      return;
    }
    element.scrollTop = element.scrollHeight;
    const observer = new ResizeObserver(() => {
      if (restoreFromTop.current) {
        element.scrollTop = element.scrollHeight - restoreFromTop.current;
        restoreFromTop.current = 0;
      } else if (stick.current) {
        element.scrollTop = element.scrollHeight;
      }
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [currentId]);

  // 切对话 / 自己发消息:强制回底并重新粘上
  useEffect(() => {
    stick.current = true;
    restoreFromTop.current = 0;
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [viewSeq]);

  // 自动填屏:首页不满一屏就没有滚动条,onScroll 永不触发 —— 有更早的就继续拉
  useEffect(() => {
    if (!ready || !hasMore || loadingOlder || !rows.length) {
      return;
    }
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    if (element.scrollHeight <= element.clientHeight + 40) {
      void loadOlder();
    }
  }, [ready, hasMore, loadingOlder, rows.length]);

  return (
    <main ref={scrollRef} className="stream" onScroll={onScroll}>
      <div key={currentId || "__draft__"} ref={innerRef} className="stream-inner">
        {loadingOlder && <span className="chip">加载更早的消息…</span>}
        {!loadingOlder && hasMore && rows.length > 0 && (
          <button className="chip chip-btn" onClick={() => void loadOlder()}>
            查看更早的消息
          </button>
        )}
        {!ready && !rows.length && <span className="chip">正在打开对话…</span>}
        {ready && !rows.length && (
          <div className="blank">
            <div className="blank-mark">
              <Icon name="send" size={26} />
            </div>
            <div className="blank-title">给 agent 发一条信息</div>
            <div className="blank-sub">它能在这台电脑上执行命令、读写文件、控制浏览器</div>
          </div>
        )}

        {blocks.map((block) => {
          if (block.kind === "stamp") {
            return (
              <span key={block.key} className="stamp">
                {block.label}
              </span>
            );
          }
          const row = block.row;
          if (row.kind === "user") {
            return (
              <div key={block.key} className={`msg me${block.tail ? " tail" : ""}`}>
                <div className="bubble me">
                  {row.images && row.images.length > 0 && (
                    <div className="message-files">
                      {row.images.map((src, index) => (
                        <img key={index} src={src} alt="图片" />
                      ))}
                    </div>
                  )}
                  {row.content}
                </div>
                {row.sending && <div className="send-state">发送中…</div>}
                {!row.sending && row.failed && (
                  <button
                    className="send-retry"
                    onClick={() => void retrySend(row, showCreatedSession)}
                  >
                    未送达 · 点击重试
                  </button>
                )}
              </div>
            );
          }
          if (row.kind === "tool") {
            return (
              <div key={block.key} className="msg them step-row">
                <ToolStep row={row} />
              </div>
            );
          }
          if (row.kind === "assistant") {
            return (
              <div key={block.key} className={`msg them${block.tail ? " tail" : ""}`}>
                {row.reasoning && <ThinkStep row={row} />}
                {row.content && (
                  <div className="bubble-line">
                    <div
                      className={`bubble them md${row.streaming ? " streaming" : ""}`}
                      dangerouslySetInnerHTML={{ __html: renderMd(row.content) }}
                    />
                    {!row.streaming && (
                      <button className="act" title="复制" onClick={() => copyText(row.content)}>
                        <Icon name="copy" size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          }
          if (row.code === "compacted" && row.content) {
            return (
              <details key={block.key} className="compaction">
                <summary>已压缩早期对话</summary>
                <div className="md" dangerouslySetInnerHTML={{ __html: renderMd(row.content) }} />
              </details>
            );
          }
          return (
            <span key={block.key} className={`chip${row.code === "error" ? " chip-bad" : ""}`}>
              {row.code === "stopped" ? "已停止" : row.content}
            </span>
          );
        })}

        {showTyping && (
          <div className="msg them tail">
            <Typing />
          </div>
        )}
      </div>
    </main>
  );
}
