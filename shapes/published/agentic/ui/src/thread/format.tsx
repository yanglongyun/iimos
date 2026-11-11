// 渲染与文案:markdown 净化、工具行的图形与标签、时间标签。
import { marked, type Tokens } from "marked";
import type { ReactNode } from "react";

import { Icon } from "../icons/Icon";
import type { Row } from "./thread";

// 净化渲染:正文来自模型和工具输出,属不可信内容,却要经 dangerouslySetInnerHTML
// 落进页面。在 marked 层掐断 XSS:丢弃原始 HTML,中和 javascript:/data: 链接。
function isUnsafeUrl(url: string) {
  return /^\s*(javascript|data|vbscript):/i.test(url);
}

class SafeRenderer extends marked.Renderer {
  html() {
    return "";
  }

  link(token: Tokens.Link) {
    if (isUnsafeUrl(token.href)) {
      return super.link({ ...token, href: "#" });
    }
    return super.link(token);
  }

  image(token: Tokens.Image) {
    if (isUnsafeUrl(token.href)) {
      return super.image({ ...token, href: "" });
    }
    return super.image(token);
  }
}

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer: new SafeRenderer(),
});

export const renderMd = (value: unknown) => marked.parse(String(value || ""), { async: false });

/* ── 工具行的图形与文案 ── */

const basename = (value: unknown) =>
  String(value ?? "")
    .split("/")
    .filter(Boolean)
    .pop() || "";

const oneLine = (value: unknown, max = 120) => {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export function toolMeta(row: Row): {
  icon: ReactNode;
  label: string;
  pill: string;
  pillWide: boolean;
} {
  const args = row.args || {};
  switch (row.name) {
    case "read":
      return {
        icon: <Icon name="doc" size={15} />,
        label: "读取",
        pill: basename(args.path),
        pillWide: false,
      };
    case "write":
      return {
        icon: <Icon name="pen" size={13} />,
        label: "写入",
        pill: basename(args.path),
        pillWide: false,
      };
    case "edit":
      return {
        icon: <Icon name="pen" size={13} />,
        label: "修改",
        pill: basename(args.path),
        pillWide: false,
      };
    case "shell":
      return {
        icon: <Icon name="terminal" size={15} />,
        label: "执行",
        pill: oneLine(args.command),
        pillWide: true,
      };
    default:
      return {
        icon: <Icon name="terminal" size={15} />,
        label: row.name || "tool",
        pill: "",
        pillWide: true,
      };
  }
}

export function isFailed(row: Row) {
  return row.failed === true;
}

export function fmtArgs(args: Record<string, unknown> | undefined) {
  return JSON.stringify(args || {}, null, 2);
}

/** 「输出」:常是压成一行的 JSON,能解析就缩进,否则原样。 */
export function fmtResult(value: unknown) {
  if (value == null || value === "") {
    return "";
  }
  const text = String(value);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/* ── 时间 ── */

/** 消息流里的「今天 / 昨天 / M月D日」分隔标签。 */
export function dayLabel(at?: number) {
  if (!at) {
    return "";
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (diff === 0) {
    return "今天";
  }
  if (diff === 1) {
    return "昨天";
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** ≥60s 显示 "N分M秒",<60s 显示 "N秒";最小 1 秒。 */
export function formatDuration(ms: number) {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) {
    return `${total} 秒`;
  }
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}
