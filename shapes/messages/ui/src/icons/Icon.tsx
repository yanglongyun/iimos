// 自绘的极简线性图标。统一 24 视窗 / 1.8 描边 / 圆头,颜色随 currentColor。

const GLYPHS = {
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
    </>
  ),
  /** 新建对话:方框 + 落笔 */
  compose: (
    <>
      <path d="M12 4.5H6.7A2.7 2.7 0 0 0 4 7.2v10.1A2.7 2.7 0 0 0 6.7 20h10.1a2.7 2.7 0 0 0 2.7-2.7V12" />
      <path d="M17.8 3.9a2 2 0 0 1 2.8 2.8l-7.6 7.6-3.6.8.8-3.6z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.4 4.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  /** 发送:向上箭头 */
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
  /** browser:地球 */
  globe: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.6 12h16.8M12 3.6c2.6 2.6 3.6 5.4 3.6 8.4s-1 5.8-3.6 8.4c-2.6-2.6-3.6-5.4-3.6-8.4s1-5.8 3.6-8.4z" />
    </>
  ),
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
  /** 设置:齿轮 */
  settings: (
    <>
      <path d="M10.3 3.6h3.4l.5 2.4a6.6 6.6 0 0 1 1.7 1l2.3-.8 1.7 2.9-1.8 1.6a6.7 6.7 0 0 1 0 2l1.8 1.6-1.7 2.9-2.3-.8a6.6 6.6 0 0 1-1.7 1l-.5 2.4h-3.4l-.5-2.4a6.6 6.6 0 0 1-1.7-1l-2.3.8-1.7-2.9 1.8-1.6a6.7 6.7 0 0 1 0-2L4.1 9.1l1.7-2.9 2.3.8a6.6 6.6 0 0 1 1.7-1z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
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

/** 头像:灰色渐变圆,中间是标题首字;Agent 用一枚小气泡标。 */
export function Avatar({
  text,
  size = 40,
  agent = false,
}: {
  text: string;
  size?: number;
  agent?: boolean;
}) {
  const letter = [...text.trim()][0] || "";
  return (
    <span
      className={`avatar${agent ? " avatar-agent" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {agent ? (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3.5c-4.9 0-8.8 3.2-8.8 7.2 0 2.3 1.3 4.3 3.3 5.6-.2 1.3-.8 2.5-1.7 3.4 1.9-.2 3.6-.9 4.9-2 .7.2 1.5.3 2.3.3 4.9 0 8.8-3.2 8.8-7.2S16.9 3.5 12 3.5z" />
        </svg>
      ) : (
        letter.toUpperCase()
      )}
    </span>
  );
}
