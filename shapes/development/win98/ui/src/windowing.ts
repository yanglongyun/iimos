export type WindowId =
  | "chat"
  | "computer"
  | "todo"
  | "notepad"
  | "settings"
  | "about";
export type Rect = { x: number; y: number; width: number; height: number };
export type Bounds = { width: number; height: number };
export type WindowState = {
  rect: Rect;
  open: boolean;
  minimized: boolean;
  maximized: boolean;
};
export type DesktopState = {
  windows: Record<WindowId, WindowState>;
  order: WindowId[];
  tasks: WindowId[];
  active: WindowId | null;
};
export type Edge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
export const WINDOW_IDS: WindowId[] = [
  "chat",
  "computer",
  "todo",
  "notepad",
  "settings",
  "about",
];

export const APPS: Record<
  WindowId,
  {
    name: string;
    title: string;
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  }
> = {
  chat: {
    name: "iimos 助手",
    title: "iimos 助手",
    width: 780,
    height: 602,
    minWidth: 420,
    minHeight: 320,
  },
  computer: {
    name: "我的电脑",
    title: "我的电脑",
    width: 650,
    height: 460,
    minWidth: 360,
    minHeight: 260,
  },
  todo: {
    name: "待办事项",
    title: "待办事项",
    width: 430,
    height: 470,
    minWidth: 320,
    minHeight: 260,
  },
  notepad: {
    name: "记事本",
    title: "便笺 - 记事本",
    width: 570,
    height: 420,
    minWidth: 300,
    minHeight: 240,
  },
  settings: {
    name: "控制面板",
    title: "模型属性",
    width: 470,
    height: 458,
    minWidth: 340,
    minHeight: 340,
  },
  about: {
    name: "关于 iimos 98",
    title: "关于 iimos 98",
    width: 450,
    height: 320,
    minWidth: 320,
    minHeight: 270,
  },
};

export function fit(rect: Rect, bounds: Bounds): Rect {
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  return {
    x: Math.max(0, Math.min(rect.x, bounds.width - width)),
    y: Math.max(0, Math.min(rect.y, bounds.height - height)),
    width,
    height,
  };
}

export function initialDesktop(bounds: Bounds): DesktopState {
  const windows = Object.fromEntries(
    WINDOW_IDS.map((id, index) => {
      const app = APPS[id];
      const x =
        id === "chat"
          ? Math.max(112, (bounds.width - app.width) / 2)
          : 174 + index * 24;
      const y =
        id === "chat"
          ? Math.max(32, (bounds.height - app.height) / 2 - 10)
          : 56 + index * 20;
      return [
        id,
        {
          rect: fit({ x, y, width: app.width, height: app.height }, bounds),
          open: id === "chat",
          minimized: false,
          maximized: false,
        },
      ];
    }),
  ) as Record<WindowId, WindowState>;
  return {
    windows,
    order: ["computer", "todo", "notepad", "settings", "about", "chat"],
    tasks: ["chat"],
    active: "chat",
  };
}

export function activate(state: DesktopState, id: WindowId): DesktopState {
  return {
    windows: {
      ...state.windows,
      [id]: { ...state.windows[id], open: true, minimized: false },
    },
    order: [...state.order.filter((value) => value !== id), id],
    tasks: state.windows[id].open ? state.tasks : [...state.tasks, id],
    active: id,
  };
}

export function hideWindow(
  state: DesktopState,
  id: WindowId,
  close: boolean,
): DesktopState {
  const windows = {
    ...state.windows,
    [id]: {
      ...state.windows[id],
      ...(close ? { open: false } : { minimized: true }),
    },
  };
  const active =
    state.active === id
      ? [...state.order]
          .reverse()
          .find((value) => windows[value].open && !windows[value].minimized) ||
        null
      : state.active;
  return {
    ...state,
    windows,
    active,
    tasks: close ? state.tasks.filter((value) => value !== id) : state.tasks,
  };
}

export function resizeRect(
  rect: Rect,
  dx: number,
  dy: number,
  edge: Edge,
  bounds: Bounds,
  minimum: { width: number; height: number },
): Rect {
  let { x, y, width, height } = rect;
  const minWidth = Math.min(minimum.width, bounds.width);
  const minHeight = Math.min(minimum.height, bounds.height);
  if (edge.includes("e"))
    width = Math.max(minWidth, Math.min(rect.width + dx, bounds.width - x));
  if (edge.includes("s"))
    height = Math.max(minHeight, Math.min(rect.height + dy, bounds.height - y));
  if (edge.includes("w")) {
    x = Math.max(0, Math.min(rect.x + dx, rect.x + rect.width - minWidth));
    width = rect.x + rect.width - x;
  }
  if (edge.includes("n")) {
    y = Math.max(0, Math.min(rect.y + dy, rect.y + rect.height - minHeight));
    height = rect.y + rect.height - y;
  }
  return { x, y, width, height };
}
