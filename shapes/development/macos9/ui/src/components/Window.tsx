import { useRef } from "react";
import type { PointerEvent, ReactNode } from "react";
import { APPS, fit, resizeRect } from "../windowing";
import type { Bounds, Edge, Rect, WindowId, WindowState } from "../windowing";

type Props = {
  id: WindowId;
  state: WindowState;
  active: boolean;
  zIndex: number;
  bounds: Bounds;
  children: ReactNode;
  onFocus: () => void;
  onRect: (rect: Rect) => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
};

export function Window({
  id,
  state,
  active,
  zIndex,
  bounds,
  children,
  onFocus,
  onRect,
  onMinimize,
  onMaximize,
  onClose,
}: Props) {
  const gesture = useRef<{
    x: number;
    y: number;
    rect: Rect;
    edge?: Edge;
  } | null>(null);
  const app = APPS[id];
  const rect = state.maximized
    ? { x: 0, y: 0, ...bounds }
    : fit(state.rect, bounds);

  const begin = (event: PointerEvent<HTMLElement>, edge?: Edge) => {
    if (
      event.button !== 0 ||
      state.maximized ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    event.preventDefault();
    onFocus();
    gesture.current = { x: event.clientX, y: event.clientY, rect, edge };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const start = gesture.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    onRect(
      start.edge
        ? resizeRect(start.rect, dx, dy, start.edge, bounds, {
            width: app.minWidth,
            height: app.minHeight,
          })
        : fit(
            { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy },
            bounds,
          ),
    );
  };
  const end = () => {
    gesture.current = null;
  };

  return (
    <section
      className={`winwindow ${active ? "active" : ""} ${state.maximized ? "maximized" : ""}`}
      hidden={!state.open || state.minimized}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        zIndex,
      }}
      role="dialog"
      aria-label={app.title}
      onPointerDown={onFocus}
    >
      <header
        className="titlebar"
        onPointerDown={(event) => begin(event)}
        onPointerMove={move}
        onPointerUp={end}
        onLostPointerCapture={end}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) onMaximize();
        }}
      >
        <button
          className="mac-close"
          aria-label={`关闭${app.name}`}
          onClick={onClose}
        >
          <span />
        </button>
        <span className="mac-title-lines" />
        <span className="window-title">{app.title}</span>
        <span className="mac-title-lines" />
        <button
          className="mac-zoom"
          aria-label={`${state.maximized ? "还原" : "最大化"}${app.name}`}
          onClick={onMaximize}
        >
          <span />
        </button>
        <button
          className="mac-collapse"
          aria-label={`隐藏${app.name}`}
          onClick={onMinimize}
        >
          <span />
        </button>
      </header>
      <div className="window-content">{children}</div>
      {!state.maximized &&
        (["n", "e", "s", "w", "ne", "nw", "se", "sw"] as Edge[]).map((edge) => (
          <span
            key={edge}
            className={`resize-handle resize-${edge}`}
            onPointerDown={(event) => begin(event, edge)}
            onPointerMove={move}
            onPointerUp={end}
            onLostPointerCapture={end}
          />
        ))}
    </section>
  );
}
