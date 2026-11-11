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
    case "browser":
      return {
        icon: <Icon name="globe" size={14} />,
        label: "浏览器",
        pill: oneLine(
          args.action === "cdp" ? `${args.method || ""}` : `${args.action || ""} ${args.url || ""}`,
        ),
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

const startOfDay = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
const two = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 列表右上角的时间:今天只显示时刻,昨天显示「昨天」,一周内显示星期,再早显示日期。 */
export function listTime(at?: number) {
  if (!at) {
    return "";
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (diff <= 0) {
    return `${date.getHours()}:${two(date.getMinutes())}`;
  }
  if (diff === 1) {
    return "昨天";
  }
  if (diff < 7) {
    return WEEKDAYS[date.getDay()];
  }
  if (date.getFullYear() === new Date().getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** 消息流里的时间标签:「今天 14:32」「昨天 9:05」「10月3日 20:11」。 */
export function stampLabel(at: number) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const time = `${date.getHours()}:${two(date.getMinutes())}`;
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (diff <= 0) {
    return `今天 ${time}`;
  }
  if (diff === 1) {
    return `昨天 ${time}`;
  }
  if (diff < 7) {
    return `${WEEKDAYS[date.getDay()]} ${time}`;
  }
  let day = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (date.getFullYear() !== new Date().getFullYear()) {
    day = `${date.getFullYear()}年${day}`;
  }
  return `${day} ${time}`;
}
