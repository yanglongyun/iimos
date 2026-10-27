import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useShell } from "./layout";

// 侧栏右边缘的拖动条，只调整侧栏宽度。
export function Resizer() {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  function start(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const column = event.currentTarget.parentElement;
    const container = column?.parentElement;
    if (!column || !container) {
      return;
    }
    event.preventDefault();
    cleanup.current?.();
    const startX = event.clientX;
    const startWidth = column.getBoundingClientRect().width;
    // 右侧对话区至少留 320px。
    const maximum = Math.min(440, container.getBoundingClientRect().width - 320);

    function move(event: MouseEvent) {
      const width = Math.min(maximum, startWidth + event.clientX - startX);
      useShell.getState().setSidebarWidth(width);
    }
    function stop() {
      document.body.classList.remove("column-resizing");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
      cleanup.current = null;
    }

    // 拖动时盖一层透明遮罩接住鼠标，指针移出侧栏也不会丢失移动和松手事件。
    document.body.classList.add("column-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    cleanup.current = stop;
  }

  return (
    <div
      className="column-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整左侧栏宽度"
      onMouseDown={start}
    />
  );
}
