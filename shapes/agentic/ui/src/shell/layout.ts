// 侧栏布局：收起 / 展开和宽度，都在本机记住，下次启动沿用。
import { create } from "zustand";

const COLLAPSED = "agentic.sidebar.collapsed";
const WIDTH = "agentic.sidebar.width";

function saved(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 无法保存时，本次窗口里仍然有效。
  }
}
const clampWidth = (width: number) => Math.min(440, Math.max(200, Math.round(width)));

interface ShellState {
  collapsed: boolean;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
}

export const useShell = create<ShellState>((set) => ({
  collapsed: saved(COLLAPSED) === "1",
  sidebarWidth: clampWidth(Number(saved(WIDTH)) || 240),
  setSidebarWidth: (width) => {
    const next = clampWidth(width);
    save(WIDTH, String(next));
    set({ sidebarWidth: next });
  },
  toggleSidebar: () =>
    set((state) => {
      save(COLLAPSED, state.collapsed ? "0" : "1");
      return { collapsed: !state.collapsed };
    }),
}));
