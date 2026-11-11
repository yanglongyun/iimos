import type { WindowId } from "../windowing";
export type IconName =
  | WindowId
  | "folder"
  | "file"
  | "drive"
  | "windows"
  | "up"
  | "save";

// 32 × 32 的整数像素图形，直接随源码维护，不依赖图标字体或远程资源。
export function Icon({ name, size = 32 }: { name: IconName; size?: number }) {
  let drawing;
  switch (name) {
    case "computer":
      drawing = (
        <>
          <path fill="#000" d="M4 2h24v21H4zM1 27h30v4H1z" />
          <path fill="#dfdfdf" d="M5 3h22v19H5zM8 23h16v4H8zM2 27h28v3H2z" />
          <path fill="#fff" d="M6 4h20v2H6zM6 4h2v16H6zM3 27h26v1H3z" />
          <path fill="#808080" d="M8 6h17v14H8zM10 24h12v2H10zM4 29h20v1H4z" />
          <path fill="#000080" d="M9 7h15v12H9z" />
          <path fill="#008080" d="M10 8h13v10H10z" />
          <path fill="#55ffff" d="M11 9h4v1h-4zM11 10h1v4h-1z" />
          <path fill="#00c000" d="M26 28h2v1h-2z" />
        </>
      );
      break;
    case "chat":
      drawing = (
        <>
          <path fill="#000" d="M2 3h26v21H15l-7 6v-6H2z" />
          <path fill="#ffffdf" d="M3 4h24v19H14l-5 4v-4H3z" />
          <path fill="#fff" d="M4 5h22v2H4z" />
          <path fill="#000080" d="M5 8h20v3H5z" />
          <path fill="#008080" d="M6 14h3v3H6zM12 14h3v3h-3zM18 14h3v3h-3z" />
          <path fill="#808080" d="M20 24h9v-9h2v11H20z" />
        </>
      );
      break;
    case "todo":
      drawing = (
        <>
          <path fill="#000" d="M6 2h20v28H6z" />
          <path fill="#dfdfdf" d="M7 3h18v26H7z" />
          <path fill="#fff" d="M8 4h16v24H8z" />
          <path fill="#808080" d="M11 1h10v6H11z" />
          <path fill="#000" d="M12 2h8v4h-8z" />
          <path
            fill="#008000"
            d="M10 8h2v2h-2zM12 10h2v2h-2zM14 7h2v4h-2zM10 15h2v2h-2zM12 17h2v2h-2zM14 14h2v4h-2zM10 22h2v2h-2zM12 24h2v2h-2zM14 21h2v4h-2z"
          />
          <path
            fill="#c0c0c0"
            d="M18 9h4v1h-4zM18 16h4v1h-4zM18 23h4v1h-4z"
          />
        </>
      );
      break;
    case "notepad":
      drawing = (
        <>
          <path fill="#000" d="M5 2h22v27H5z" />
          <path fill="#808080" d="M7 4h22v27H7z" />
          <path fill="#fff" d="M6 3h20v25H6z" />
          <path fill="#008080" d="M6 3h20v4H6z" />
          <path
            fill="#c0c0c0"
            d="M9 10h14v1H9zM9 14h14v1H9zM9 18h14v1H9zM9 22h10v1H9z"
          />
          <path
            fill="#000"
            d="M9 1h1v5H9zM14 1h1v5h-1zM19 1h1v5h-1zM24 1h1v5h-1z"
          />
        </>
      );
      break;
    case "settings":
      drawing = (
        <>
          <path fill="#000" d="M2 4h28v24H2z" />
          <path fill="#dfdfdf" d="M3 5h26v22H3z" />
          <path fill="#fff" d="M4 6h24v2H4z" />
          <path fill="#000080" d="M4 8h24v3H4z" />
          <path fill="#808080" d="M7 14h18v1H7zM7 20h18v1H7z" />
          <path fill="#000" d="M11 12h4v7h-4zM20 18h4v7h-4z" />
          <path fill="#c0c0c0" d="M12 13h2v5h-2zM21 19h2v5h-2z" />
        </>
      );
      break;
    case "folder":
      drawing = (
        <>
          <path fill="#000" d="M2 7h11l3 3h14v18H2z" />
          <path fill="#ffff80" d="M3 8h10l3 3h13v15H3z" />
          <path fill="#808000" d="M4 13h27l-4 15H1z" />
          <path fill="#ffff00" d="M5 14h25l-4 13H2z" />
          <path fill="#ffffbf" d="M5 14h24v2H5z" />
        </>
      );
      break;
    case "drive":
      drawing = (
        <>
          <path fill="#000" d="M5 7h22l4 15v7H1v-7z" />
          <path fill="#dfdfdf" d="M6 8h20l3 14H3z" />
          <path fill="#808080" d="M2 23h28v5H2z" />
          <path fill="#fff" d="M3 23h26v1H3z" />
          <path fill="#000" d="M5 25h15v1H5z" />
          <path fill="#00ff00" d="M25 25h3v1h-3z" />
        </>
      );
      break;
    case "windows":
      drawing = (
        <>
          <path
            fill="#000"
            d="M5 3h21v23H5zM2 6h2v3H2zM1 12h3v3H1zM2 19h2v3H2z"
          />
          <path fill="#ff3f21" d="M7 5h8v9H7z" />
          <path fill="#00a800" d="M17 5h7v9h-7z" />
          <path fill="#004cff" d="M7 16h8v8H7z" />
          <path fill="#ffff00" d="M17 16h7v8h-7z" />
        </>
      );
      break;
    case "about":
      drawing = (
        <>
          <path
            fill="#000"
            d="M8 2h16v2h4v4h2v16h-2v4h-4v2H8v-2H4v-4H2V8h2V4h4z"
          />
          <path
            fill="#000080"
            d="M8 3h16v2h3v3h2v16h-2v3h-3v2H8v-2H5v-3H3V8h2V5h3z"
          />
          <path fill="#fff" d="M14 7h4v4h-4zM12 14h6v10h3v2H11v-2h3v-8h-2z" />
        </>
      );
      break;
    case "up":
      drawing = (
        <>
          <path fill="#000" d="M3 15 16 2l13 13h-8v14H11V15z" />
          <path fill="#ffff00" d="m6 14 10-10 10 10h-7v13h-6V14z" />
        </>
      );
      break;
    case "save":
      drawing = (
        <>
          <path fill="#000" d="M3 2h24l3 4v24H2V2z" />
          <path fill="#000080" d="M3 3h23l3 4v22H3z" />
          <path fill="#c0c0c0" d="M7 3h16v10H7z" />
          <path fill="#000" d="M18 4h3v7h-3z" />
          <path fill="#fff" d="M7 17h17v12H7z" />
          <path fill="#808080" d="M10 20h11v1H10zM10 24h11v1H10z" />
        </>
      );
      break;
    default:
      drawing = (
        <>
          <path fill="#000" d="M6 1h14l7 7v23H6z" />
          <path fill="#fff" d="M7 2h12v7h7v21H7z" />
          <path
            fill="#c0c0c0"
            d="m20 3 5 5h-5zM10 13h12v1H10zM10 17h12v1H10zM10 21h12v1H10zM10 25h8v1h-8z"
          />
        </>
      );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="pixel-icon"
    >
      {drawing}
    </svg>
  );
}
