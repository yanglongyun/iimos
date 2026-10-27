import { useId } from "react";
// 自绘的极简线性图标。统一 24 视窗 / 1.8 描边 / 圆头,颜色随 currentColor。

const GLYPHS = {
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
    </>
  ),
  /** 新对话:方框 + 落笔 */
  compose: (
    <>
      <path d="M12 4.5H6.7A2.7 2.7 0 0 0 4 7.2v10.1A2.7 2.7 0 0 0 6.7 20h10.1a2.7 2.7 0 0 0 2.7-2.7V12" />
      <path d="M17.8 3.9a2 2 0 0 1 2.8 2.8l-7.6 7.6-3.6.8.8-3.6z" />
    </>
  ),
  /** 侧栏开关:面板 */
  panel: (
    <>
      <rect x="3.5" y="4.8" width="17" height="14.4" rx="2.6" />
      <path d="M9.6 4.8v14.4" />
    </>
  ),
  send: (
    <>
      <path d="M12 19V5.6" />
      <path d="M6.2 11.2 12 5.4l5.8 5.8" />
    </>
  ),
  /** 停止:实心圆角方块 */
  stop: (
    <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.4" fill="currentColor" stroke="none" />
  ),
  /** 展开:右尖号 */
  chev: <path d="m9.2 5.8 6.2 6.2-6.2 6.2" />,
  /** shell:终端 */
  terminal: (
    <>
      <rect x="3.5" y="4.8" width="17" height="14.4" rx="2.6" />
      <path d="m7.2 9.3 3 2.7-3 2.7" />
      <path d="M12.8 15h4" />
    </>
  ),
  /** read:折角文档 */
  doc: (
    <>
      <path d="M13.6 3.6H8a2.2 2.2 0 0 0-2.2 2.2v12.4A2.2 2.2 0 0 0 8 20.4h8a2.2 2.2 0 0 0 2.2-2.2V8.2z" />
      <path d="M13.6 3.6v4.6h4.6" />
      <path d="M9 12.6h6M9 15.8h4" />
    </>
  ),
  /** write / edit:笔 */
  pen: <path d="M16.9 4.1a2.4 2.4 0 0 1 3.4 3.4l-9.8 9.8-4.6 1.2 1.2-4.6z" />,
  /** 置顶:图钉 */
  pin: <path d="M9.5 3.8h5l-.8 5.2 3.1 3.1v1.9H7.2v-1.9l3.1-3.1zM12 14v6.2" />,
  /** 思考:四芒星 */
  spark: <path d="M12 3.8l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9z" />,
  trash: (
    <>
      <path d="M4.8 7h14.4" />
      <path d="M9.6 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="m6.6 7 .8 12h9.2l.8-12" />
      <path d="M10.2 10.6v5M13.8 10.6v5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.2" />
      <path d="M15 5.4H7.2A2.2 2.2 0 0 0 5 7.6v7.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.6v2M12 18.4v2M3.6 12h2M18.4 12h2M6.1 6.1l1.4 1.4M16.5 16.5l1.4 1.4M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4" />
    </>
  ),
  /** 任务:单色波形 */
};

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPHS[name]}
    </svg>
  );
}

/** 品牌标:圆角方块里一枚提示符。空状态和侧栏共用。 */
export function Mark({ size = 26 }: { size?: number }) {
  const gradientId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient
          id={gradientId}
          x1="4"
          y1="4"
          x2="28"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#6c70f8" />
          <stop offset="0.48" stopColor="#5a5ff5" />
          <stop offset="1" stopColor="#7b5cf0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8.5" fill={`url(#${gradientId})`} />
      <path
        d="m11 11 5.4 5-5.4 5M18.6 21.4h4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
