// 过程行:思考 / 工具调用各折成一行,点开看参数和结果。放在 agent 气泡那一侧,比气泡小一号。
import { Icon } from "../icons/Icon";
import { fmtArgs, fmtResult, toolMeta } from "./format";
import { useThread } from "./store";
import type { Row } from "./thread";

// 展开状态属于当前会话，列表重排和刷新不会丢失。
function useExpanded(key: string): [boolean, (open: boolean) => void] {
  const open = useThread((state) => state.expanded[key] === true);
  const setOpen = (value: boolean) =>
    useThread.setState((state) => ({ expanded: { ...state.expanded, [key]: value } }));
  return [open, setOpen];
}

export function ThinkStep({ row }: { row: Row }) {
  const [open, setOpen] = useExpanded(row.key);
  const thinking = Boolean(row.streaming && !row.content);
  return (
    <div className={`step${open ? " open" : ""}`}>
      <button className="step-head" onClick={() => setOpen(!open)}>
        <span className="step-ic">
          <Icon name="spark" size={13} />
        </span>
        <span className={`step-label${thinking ? " pulse" : ""}`}>
          {thinking ? "思考中…" : "已思考"}
        </span>
        <span className="step-chev">
          <Icon name="chev" size={11} />
        </span>
      </button>
      {open && <pre className="step-body">{row.reasoning}</pre>}
    </div>
  );
}

export function ToolStep({ row }: { row: Row }) {
  const [open, setOpen] = useExpanded(row.key);
  const meta = toolMeta(row);
  const running = row.status === "running";
  return (
    <div className={`step${open ? " open" : ""}${row.failed ? " failed" : ""}`}>
      <button className="step-head" onClick={() => setOpen(!open)}>
        <span className="step-ic">{meta.icon}</span>
        <span className={`step-label${running ? " pulse" : ""}`}>{meta.label}</span>
        {meta.pill && <span className="step-pill clip">{meta.pill}</span>}
        {running ? (
          <span className="step-dot" aria-label="执行中" />
        ) : (
          <span className="step-chev">
            <Icon name="chev" size={11} />
          </span>
        )}
      </button>
      {open && (
        <div className="step-body">
          <pre>{fmtArgs(row.args)}</pre>
          <pre>{running ? "执行中…" : row.result ? fmtResult(row.result) : "没有输出"}</pre>
          {row.images && row.images.length > 0 && (
            <div className="message-files">
              {row.images.map((src, index) => (
                <img key={index} src={src} alt="工具读取的图片" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 对方「正在输入」的三个点。 */
export function Typing() {
  return (
    <div className="bubble them typing" aria-label="正在输入">
      <span />
      <span />
      <span />
    </div>
  );
}
